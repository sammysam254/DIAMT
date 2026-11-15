'use strict';

/**
 * ============================================================================
 * Production Multi-Device Host Bridge & WebSocket Relay (scrcpy v3.3.4)
 * ============================================================================
 * Multi-device orchestrator:
 *  - Automatically tracks USB devices via adb track-devices (or adbkit)
 *  - Manages isolated DeviceWorker instances per phone with dynamic port pool
 *  - Serves HTTP REST endpoints (/health, /api/devices, /api/device/:serial)
 *  - Routes /ws/device/:serial WebSocket connections to the matching DeviceWorker
 *  - Sends periodic heartbeats / status synchronization to Cloud Rental Dashboard
 *  - Handles clean signal shutdowns and teardowns
 */

const http = require('http');
const https = require('https');
const url = require('url');
const os = require('os');
const { spawn, execFile } = require('child_process');
const config = require('./config');
const DeviceWorker = require('./device-worker');

const crypto = require('crypto');

// Import WebSocket library (ws) with built-in RFC 6455 fallback
let WebSocketServer;
try {
  const wsPkg = require('ws');
  WebSocketServer = wsPkg.Server || wsPkg.WebSocketServer;
} catch (_) {
  // Graceful fallback to built-in RFC 6455 server
}

/**
 * Lightweight Built-in RFC 6455 WebSocket Socket wrapper for environments without the 'ws' npm package
 */
class BuiltinWebSocketClient {
  constructor(socket) {
    this.socket = socket;
    this.readyState = 1; // OPEN
    this._listeners = new Map();
    this.socket.setNoDelay(true);

    let buffer = Buffer.alloc(0);

    this.socket.on('data', (chunk) => {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);

      while (buffer.length >= 2) {
        const firstByte = buffer[0];
        const secondByte = buffer[1];
        const opcode = firstByte & 0x0f;
        const isMasked = (secondByte & 0x80) !== 0;
        let payloadLen = secondByte & 0x7f;
        let offset = 2;

        if (payloadLen === 126) {
          if (buffer.length < 4) break;
          payloadLen = buffer.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (buffer.length < 10) break;
          payloadLen = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }

        let maskKey = null;
        if (isMasked) {
          if (buffer.length < offset + 4) break;
          maskKey = buffer.subarray(offset, offset + 4);
          offset += 4;
        }

        if (buffer.length < offset + payloadLen) break;

        let payload = buffer.subarray(offset, offset + payloadLen);
        buffer = buffer.subarray(offset + payloadLen);

        if (isMasked && maskKey) {
          const unmasked = Buffer.allocUnsafe(payloadLen);
          for (let i = 0; i < payloadLen; i++) {
            unmasked[i] = payload[i] ^ maskKey[i % 4];
          }
          payload = unmasked;
        }

        // Handle Control Frames
        if (opcode === 0x08) { // CLOSE
          this.close();
          return;
        } else if (opcode === 0x09) { // PING
          this._sendFrame(0x8A, payload); // PONG
        } else if (opcode === 0x01) { // TEXT
          this._emit('message', payload.toString('utf-8'), false);
        } else if (opcode === 0x02) { // BINARY
          this._emit('message', payload, true);
        }
      }
    });

    this.socket.on('close', () => {
      this.readyState = 3; // CLOSED
      this._emit('close');
    });

    this.socket.on('error', (err) => {
      this._emit('error', err);
    });
  }

  get bufferedAmount() {
    return this.socket.writableLength || 0;
  }

  send(data, options = {}) {
    if (this.readyState !== 1 || this.socket.destroyed) return;
    const isBinary = options.binary || Buffer.isBuffer(data) || data instanceof Uint8Array;
    const payload = Buffer.isBuffer(data) ? data : (data instanceof Uint8Array ? Buffer.from(data) : Buffer.from(String(data), 'utf-8'));
    const opcode = isBinary ? 0x82 : 0x81;
    this._sendFrame(opcode, payload);
  }

  _sendFrame(headerByte, payload) {
    const len = payload.length;
    let header;

    if (len <= 125) {
      header = Buffer.allocUnsafe(2);
      header[0] = headerByte;
      header[1] = len;
    } else if (len <= 65535) {
      header = Buffer.allocUnsafe(4);
      header[0] = headerByte;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[0] = headerByte;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }

    try {
      this.socket.write(header);
      this.socket.write(payload);
    } catch (_) {}
  }

  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    try {
      const reasonBuf = Buffer.from(reason, 'utf-8');
      const closePayload = Buffer.allocUnsafe(2 + reasonBuf.length);
      closePayload.writeUInt16BE(code, 0);
      reasonBuf.copy(closePayload, 2);
      this._sendFrame(0x88, closePayload);
      this.socket.end();
    } catch (_) {
      try { this.socket.destroy(); } catch (_) {}
    }
  }

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(handler);
  }

  _emit(event, ...args) {
    const handlers = this._listeners.get(event) || [];
    for (const h of handlers) h(...args);
  }
}

// ============================================================================
// Port Pool Manager
// ============================================================================

class PortPool {
  constructor(startPort, endPort) {
    this.startPort = startPort;
    this.endPort = endPort;
    this.usedPorts = new Set();
  }

  allocate() {
    for (let port = this.startPort; port <= this.endPort; port++) {
      if (!this.usedPorts.has(port)) {
        this.usedPorts.add(port);
        return port;
      }
    }
    throw new Error(`[PortPool] Exhausted ports between ${this.startPort} and ${this.endPort}`);
  }

  release(port) {
    this.usedPorts.delete(port);
  }
}

const portPool = new PortPool(config.basePort, config.maxPort);

// ============================================================================
// State Registry
// ============================================================================

/** @type {Map<string, DeviceWorker>} Map of serial -> DeviceWorker */
const deviceWorkers = new Map();

// ============================================================================
// Device Tracker (adb track-devices + adbkit hybrid)
// ============================================================================

class DeviceTracker {
  constructor(adbBin, onDeviceAdded, onDeviceRemoved) {
    this.adbBin = adbBin;
    this.onDeviceAdded = onDeviceAdded;
    this.onDeviceRemoved = onDeviceRemoved;
    this.activeSerials = new Set();
    this.trackerProc = null;
    this.pollInterval = null;
  }

  start() {
    this._startTrackDevicesProcess();
    // Safety polling every 5s to catch edge cases
    this.pollInterval = setInterval(() => this._pollAdbDevices(), 5000);
    this._pollAdbDevices();
  }

  _startTrackDevicesProcess() {
    try {
      console.log(`[DeviceTracker] Spawning "${this.adbBin} track-devices"...`);
      const proc = spawn(this.adbBin, ['track-devices'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.trackerProc = proc;
      let buffer = '';

      proc.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop(); // keep remainder

        const currentBatch = new Set();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 2) {
            const serial = parts[0];
            const state = parts[1];
            if (state === 'device') {
              currentBatch.add(serial);
            }
          }
        }

        this._reconcileDevices(currentBatch);
      });

      proc.on('close', (code) => {
        console.warn(`[DeviceTracker] adb track-devices closed (code ${code}). Restarting in 3s...`);
        this.trackerProc = null;
        setTimeout(() => this._startTrackDevicesProcess(), 3000);
      });

      proc.on('error', (err) => {
        console.warn(`[DeviceTracker] track-devices process error: ${err.message}`);
      });
    } catch (err) {
      console.warn(`[DeviceTracker] Failed to start track-devices: ${err.message}`);
    }
  }

  _pollAdbDevices() {
    execFile(this.adbBin, ['devices'], { windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return;
      const lines = stdout.split(/\r?\n/);
      const currentBatch = new Set();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('List of devices')) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2 && parts[1] === 'device') {
          currentBatch.add(parts[0]);
        }
      }
      this._reconcileDevices(currentBatch);
    });
  }

  _reconcileDevices(newSet) {
    // Detect newly plugged-in devices
    for (const serial of newSet) {
      if (!this.activeSerials.has(serial)) {
        this.activeSerials.add(serial);
        this.onDeviceAdded(serial);
      }
    }

    // Detect unplugged devices
    for (const serial of this.activeSerials) {
      if (!newSet.has(serial)) {
        this.activeSerials.delete(serial);
        this.onDeviceRemoved(serial);
      }
    }
  }

  stop() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.trackerProc) {
      try { this.trackerProc.kill(); } catch (_) {}
      this.trackerProc = null;
    }
  }
}

// ============================================================================
// Worker Lifecycle Management
// ============================================================================

async function handleDeviceConnected(serial) {
  if (deviceWorkers.has(serial)) {
    const existing = deviceWorkers.get(serial);
    if (existing.status === 'running') return;
  }

  console.log(`[HostBridge] Device attached: ${serial}`);
  let port;
  try {
    port = portPool.allocate();
  } catch (err) {
    console.error(`[HostBridge] Cannot allocate port for ${serial}: ${err.message}`);
    return;
  }

  const worker = new DeviceWorker(serial, port, config);
  deviceWorkers.set(serial, worker);

  worker.on('error', (err) => {
    console.error(`[HostBridge] Worker error for ${serial}: ${err.message}`);
    syncDashboardImmediately();
  });

  worker.on('stopped', () => {
    portPool.release(port);
    deviceWorkers.delete(serial);
    syncDashboardImmediately();
  });

  try {
    await worker.start();
    syncDashboardImmediately();
  } catch (err) {
    console.error(`[HostBridge] Failed to launch worker for ${serial}: ${err.message}`);
    portPool.release(port);
    deviceWorkers.delete(serial);
    syncDashboardImmediately();
  }
}

async function handleDeviceDisconnected(serial) {
  console.log(`[HostBridge] Device detached: ${serial}`);
  const worker = deviceWorkers.get(serial);
  if (worker) {
    await worker.stop();
    portPool.release(worker.port);
    deviceWorkers.delete(serial);
    syncDashboardImmediately();
  }
}

// ============================================================================
// HTTP API & Health Endpoints
// ============================================================================

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Enable CORS for cloud dashboard integration
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /health
  if (pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      hostname: os.hostname(),
      devicesConnected: deviceWorkers.size,
      scrcpyVersion: config.scrcpyVersion,
      portsInUse: Array.from(portPool.usedPorts),
    }));
    return;
  }

  // GET /api/devices
  if (pathname === '/api/devices' && req.method === 'GET') {
    const list = Array.from(deviceWorkers.values()).map(w => w.getSummary());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ devices: list }));
    return;
  }

  // GET /api/device/:serial
  if (pathname.startsWith('/api/device/') && req.method === 'GET') {
    const serial = pathname.replace('/api/device/', '').split('/')[0];
    const worker = deviceWorkers.get(serial);
    if (!worker) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Device ${serial} not found or offline` }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(worker.getSummary()));
    return;
  }

  // POST /api/device/:serial/restart
  if (pathname.startsWith('/api/device/') && pathname.endsWith('/restart') && req.method === 'POST') {
    const serial = pathname.replace('/api/device/', '').replace('/restart', '');
    const worker = deviceWorkers.get(serial);
    if (!worker) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Device ${serial} not found` }));
      return;
    }
    worker.stop().then(() => handleDeviceConnected(serial)).catch(() => {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: `Restarting stream for device ${serial}` }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

// ============================================================================
// WebSocket Server Routing (/ws/device/:serial)
// ============================================================================

let wss = WebSocketServer ? new WebSocketServer({ noServer: true }) : null;

server.on('upgrade', (request, socket, head) => {
  const parsedUrl = url.parse(request.url, true);
  const pathname = parsedUrl.pathname;

  // Check path matching: /ws/device/:serial
  const match = pathname.match(/^\/ws\/device\/([^/?#]+)/);
  if (!match) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  const serial = decodeURIComponent(match[1]).trim();
  const token = parsedUrl.query.token;

  // Optional token validation
  if (config.auth?.requireToken && !token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  // Lookup device worker (exact or case-insensitive)
  let worker = deviceWorkers.get(serial);
  if (!worker) {
    for (const [s, w] of deviceWorkers.entries()) {
      if (s.toLowerCase() === serial.toLowerCase()) {
        worker = w;
        break;
      }
    }
  }

  if (!worker || worker.status !== 'running') {
    console.warn(`[HostBridge] WS upgrade rejected: device "${serial}" is offline or initializing`);
    socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    socket.destroy();
    return;
  }

  if (wss) {
    // ws package path
    wss.handleUpgrade(request, socket, head, (ws) => {
      worker.addClient(ws);

      ws.on('message', (data, isBinary) => {
        worker.handleClientControl(isBinary ? data : data.toString());
      });

      ws.on('close', () => {
        worker.removeClient(ws);
      });

      ws.on('error', (err) => {
        console.warn(`[HostBridge] Client WS error on ${serial}: ${err.message}`);
        worker.removeClient(ws);
      });
    });
  } else {
    // Built-in RFC 6455 fallback path
    const secKey = request.headers['sec-websocket-key'];
    if (!secKey) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const acceptKey = crypto
      .createHash('sha1')
      .update(secKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '\r\n'
    ];
    socket.write(headers.join('\r\n'));

    const ws = new BuiltinWebSocketClient(socket);
    worker.addClient(ws);

    ws.on('message', (data, isBinary) => {
      worker.handleClientControl(isBinary ? data : data.toString());
    });

    ws.on('close', () => {
      worker.removeClient(ws);
    });

    ws.on('error', (err) => {
      console.warn(`[HostBridge] Client WS error on ${serial}: ${err.message}`);
      worker.removeClient(ws);
    });
  }
});

// ============================================================================
// Cloud Rental Dashboard Sync & Heartbeat
// ============================================================================

let syncTimeout = null;
function syncDashboardImmediately() {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => sendHeartbeatToCloudDashboard(), 500);
}

function sendHeartbeatToCloudDashboard() {
  const webhookUrl = config.cloudDashboard?.webhookUrl;
  if (!webhookUrl || !webhookUrl.startsWith('http')) return;

  const devicesList = Array.from(deviceWorkers.values()).map(w => w.getSummary());
  const payload = JSON.stringify({
    event: 'heartbeat',
    hostname: os.hostname(),
    timestamp: new Date().toISOString(),
    apiKey: config.cloudDashboard.apiKey || '',
    bindingCode: config.cloudDashboard.agentBindingCode || '',
    activeDeviceCount: devicesList.length,
    devices: devicesList,
  });

  const parsed = url.parse(webhookUrl);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      ...(config.cloudDashboard.apiKey ? { 'Authorization': `Bearer ${config.cloudDashboard.apiKey}` } : {}),
    },
    timeout: 8000,
  };

  const req = transport.request(options, (res) => {
    // Consume response to free memory
    res.resume();
  });

  req.on('error', (err) => {
    // Cloud dashboard may be offline or unreachable; log notice without crashing
    // console.warn(`[CloudSync] Heartbeat notice: ${err.message}`);
  });

  req.write(payload);
  req.end();
}

// Periodic cloud heartbeat
if (config.cloudDashboard?.heartbeatIntervalMs > 0) {
  setInterval(() => {
    sendHeartbeatToCloudDashboard();
  }, config.cloudDashboard.heartbeatIntervalMs);
}

// ============================================================================
// Startup & Clean Shutdown
// ============================================================================

const tracker = new DeviceTracker(config.adbPath, handleDeviceConnected, handleDeviceDisconnected);

server.listen(config.serverPort, config.serverHost, () => {
  console.log(`================================================================`);
  console.log(` DIAMT scrcpy v3.3.4 Host Bridge & WebSocket Relay Running`);
  console.log(` HTTP & WebSocket Port  : ${config.serverPort}`);
  console.log(` Forward Port Range     : ${config.basePort} - ${config.maxPort}`);
  console.log(` Resolved adb.exe       : ${config.adbPath}`);
  console.log(` Resolved scrcpy-server : ${config.scrcpyServerPath}`);
  console.log(` Cloud Dashboard Sync   : ${config.cloudDashboard.webhookUrl || 'Disabled'}`);
  console.log(`================================================================`);

  // Start ADB tracking
  tracker.start();
});

// Graceful termination
async function shutdown(signal) {
  console.log(`\n[HostBridge] Received ${signal}. Shutting down cleanly...`);
  tracker.stop();

  const stopPromises = Array.from(deviceWorkers.values()).map(worker => worker.stop());
  await Promise.allSettled(stopPromises);
  deviceWorkers.clear();

  server.close(() => {
    console.log('[HostBridge] All device sessions and server listeners terminated.');
    process.exit(0);
  });

  setTimeout(() => process.exit(0), 4000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { server, deviceWorkers, portPool };
