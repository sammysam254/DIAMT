'use strict';

/**
 * ============================================================================
 * DeviceWorker — Isolated scrcpy v3.3.4 Session Manager for a Single Device
 * ============================================================================
 * Manages:
 *  1. ADB push of official scrcpy-server v3.3.4 to /data/local/tmp/scrcpy-server.jar
 *  2. Unique TCP port forwarding (adb forward tcp:<PORT> localabstract:scrcpy)
 *  3. Process spawn: app_process / com.genymobile.scrcpy.Server 3.3.4 ...
 *  4. TCP connection to Video (socket 1) & Control (socket 2) with setNoDelay(true)
 *  5. Parsing v3.3.4 video stream (77-byte device header + 12-byte frame headers)
 *  6. SPS/PPS (bit 63) and IDR Keyframe (bit 62) memory caching
 *  7. WebSocket client distribution with backpressure & frame-1 instant keyframe flush
 *  8. Scrcpy v3.3.4 binary control message injection (touch, keycode, text, clipboard)
 *  9. Clean teardown releasing ports and killing orphaned remote processes
 */

const { spawn, execFile } = require('child_process');
const net = require('net');
const EventEmitter = require('events');

// Scrcpy Control Message Types
const CONTROL_MSG_INJECT_KEYCODE = 0;
const CONTROL_MSG_INJECT_TEXT = 1;
const CONTROL_MSG_INJECT_TOUCH_EVENT = 2;
const CONTROL_MSG_SET_CLIPBOARD = 9;

class DeviceWorker extends EventEmitter {
  /**
   * @param {string} serial - Android device ADB serial
   * @param {number} port - Dedicated local TCP port for ADB forward
   * @param {object} config - Configuration object
   */
  constructor(serial, port, config) {
    super();
    this.serial = serial;
    this.port = port;
    this.config = config;
    this.adbBin = config.adbPath || 'adb.exe';
    this.scrcpyServerPath = config.scrcpyServerPath;

    // Worker state
    this.status = 'initializing'; // 'initializing' | 'running' | 'stopped' | 'error'
    this.serverProcess = null;
    this.videoSocket = null;
    this.controlSocket = null;
    this.wsClients = new Set();

    // Stream metadata & keyframe cache
    this.deviceMeta = {
      name: '',
      codec: 'h264',
      width: 1080,
      height: 1920,
      model: 'Android Device',
      battery: 100,
    };
    this.cachedSpsPps = null;      // Config NAL units (SPS / PPS)
    this.cachedKeyframe = null;    // Latest complete IDR Keyframe
    this.cachedKeyframeTime = 0;
    this.lastFrameTime = 0;
    this.framesSentCount = 0;
    this.bytesSentCount = 0;

    // Stream state tracking
    this._isStarting = false;
    this._isStopping = false;
    this._reconnectTimer = null;
  }

  /**
   * Starts the complete scrcpy v3.3.4 worker pipeline for this device.
   */
  async start() {
    if (this._isStarting || this.status === 'running') return;
    this._isStarting = true;
    this.status = 'initializing';
    console.log(`[DeviceWorker ${this.serial}] Initializing scrcpy v3.3.4 session on forward port ${this.port}...`);

    try {
      // 1. Query device hardware properties
      await this._fetchDeviceInfo();

      // 2. Kill any lingering zombie scrcpy server processes on the device
      await this._killRemoteZombie();

      // 3. Push official scrcpy-server v3.3.4 to device tmp
      await this._pushScrcpyServer();

      // 4. Setup ADB TCP port forwarding
      await this._setupAdbForward();

      // 5. Spawn app_process com.genymobile.scrcpy.Server 3.3.4
      await this._spawnServerProcess();

      // 6. Connect local TCP sockets to ADB tunnel (Socket 1: Video, Socket 2: Control)
      await this._connectSockets();

      // 7. Start dedicated audio stream for internal sound capture
      this._startAudioStream().catch(() => {});

      this.status = 'running';
      this._isStarting = false;
      this.emit('started', { serial: this.serial, port: this.port, meta: this.deviceMeta });
      console.log(`[DeviceWorker ${this.serial}] scrcpy v3.3.4 pipeline active and streaming (res: ${this.deviceMeta.width}x${this.deviceMeta.height})`);
    } catch (err) {
      this._isStarting = false;
      this.status = 'error';
      console.error(`[DeviceWorker ${this.serial}] Startup failed: ${err.message}`);
      this.emit('error', err);
      // Clean up failed state
      this._cleanupSockets();
      throw err;
    }
  }

  /**
   * Gather device model, resolution, and battery level via ADB
   */
  async _fetchDeviceInfo() {
    try {
      const [modelOut, sizeOut, batteryOut] = await Promise.all([
        this._execAdb(['shell', 'getprop', 'ro.product.model']),
        this._execAdb(['shell', 'wm', 'size']),
        this._execAdb(['shell', 'dumpsys', 'battery']),
      ]);

      if (modelOut && modelOut.trim()) {
        this.deviceMeta.model = modelOut.trim();
      }

      const sizeMatch = sizeOut.match(/Physical size:\s*(\d+)x(\d+)/i) || sizeOut.match(/(\d+)x(\d+)/);
      if (sizeMatch) {
        this.deviceMeta.width = parseInt(sizeMatch[1], 10);
        this.deviceMeta.height = parseInt(sizeMatch[2], 10);
      }

      const battMatch = batteryOut.match(/level:\s*(\d+)/i);
      if (battMatch) {
        this.deviceMeta.battery = parseInt(battMatch[1], 10);
      }
    } catch (e) {
      console.warn(`[DeviceWorker ${this.serial}] Failed to query some device props: ${e.message}`);
    }
  }

  /**
   * Push official scrcpy-server v3.3.4 to /data/local/tmp/scrcpy-server.jar
   */
  async _pushScrcpyServer() {
    const remoteJar = '/data/local/tmp/scrcpy-server.jar';
    console.log(`[DeviceWorker ${this.serial}] Pushing "${this.scrcpyServerPath}" to ${remoteJar}...`);
    await this._execAdb(['push', this.scrcpyServerPath, remoteJar]);
    await this._execAdb(['shell', 'chmod', '755', remoteJar]);
  }

  /**
   * Configure ADB local TCP port forwarding to abstract socket 'scrcpy'
   */
  async _setupAdbForward() {
    // Remove any stale forward on this port first
    try {
      await this._execAdb(['forward', '--remove', `tcp:${this.port}`]);
    } catch (_) {}

    console.log(`[DeviceWorker ${this.serial}] Forwarding tcp:${this.port} -> localabstract:scrcpy`);
    await this._execAdb(['forward', `tcp:${this.port}`, 'localabstract:scrcpy']);
  }

  /**
   * Kill any previous scrcpy instance running on this device
   */
  async _killRemoteZombie() {
    try {
      await this._execAdb(['shell', 'pkill', '-9', '-f', 'scrcpy-server']);
    } catch (_) {}
    try {
      await this._execAdb(['shell', 'pkill', '-9', '-f', 'com.genymobile.scrcpy']);
    } catch (_) {}
  }

  /**
   * Spawns app_process with exact scrcpy v3.3.4 protocol parameters
   */
  _spawnServerProcess() {
    return new Promise((resolve, reject) => {
      const v = this.config.video;
      const args = [
        '-s', this.serial,
        'shell',
        'CLASSPATH=/data/local/tmp/scrcpy-server.jar',
        'app_process',
        '/',
        'com.genymobile.scrcpy.Server',
        this.config.scrcpyVersion || '3.3.4',
        `tunnel_forward=${v.tunnelForward !== false}`,
        `audio=${v.audio === true}`,
        `control=${v.control !== false}`,
        `cleanup=${v.cleanup === true}`,
        `max_size=${v.maxSize || 1080}`,
        `video_bit_rate=${v.videoBitRate || 4000000}`,
        `max_fps=${v.maxFps || 60}`,
        `i_frame_interval=${v.iFrameInterval || 2}`,
      ];

      console.log(`[DeviceWorker ${this.serial}] Executing: ${this.adbBin} ${args.join(' ')}`);

      const proc = spawn(this.adbBin, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.serverProcess = proc;
      let readyHandled = false;

      const onData = (chunk) => {
        const text = chunk.toString();
        // scrcpy-server logs to stdout/stderr: "[server] INFO: Device: ..."
        if (text.includes('[server]') || text.includes('Device:') || text.includes('scrcpy')) {
          if (!readyHandled) {
            readyHandled = true;
            resolve();
          }
        }
      };

      proc.stdout.on('data', onData);
      proc.stderr.on('data', onData);

      proc.on('error', (err) => {
        console.error(`[DeviceWorker ${this.serial}] Process error: ${err.message}`);
        if (!readyHandled) {
          readyHandled = true;
          reject(err);
        }
      });

      proc.on('close', (code) => {
        console.warn(`[DeviceWorker ${this.serial}] scrcpy process exited with code ${code}`);
        this.serverProcess = null;
        if (this.status === 'running' && !this._isStopping) {
          this.status = 'error';
          this.emit('disconnected', { serial: this.serial, code });
        }
      });

      // Fail-safe: if stdout does not print within 1800ms, proceed to socket connection attempts
      setTimeout(() => {
        if (!readyHandled) {
          readyHandled = true;
          resolve();
        }
      }, 1800);
    });
  }

  /**
   * Connect local TCP sockets to ADB forward port.
   * With tunnel_forward=true, scrcpy-server accepts:
   *   Connection 1: Video Socket
   *   Connection 2: Control Socket
   */
  async _connectSockets() {
    console.log(`[DeviceWorker ${this.serial}] Connecting Video Socket (1) on 127.0.0.1:${this.port}...`);
    this.videoSocket = await this._connectTcpWithRetry(this.port, 35, 120);
    this.videoSocket.setNoDelay(true); // Disable Nagle's algorithm for zero latency

    // Attach v3.3.4 video stream parser
    this._setupVideoStreamParser(this.videoSocket);

    // Slight delay before connecting the second socket to allow server accept queue to progress
    await new Promise(r => setTimeout(r, 80));

    console.log(`[DeviceWorker ${this.serial}] Connecting Control Socket (2) on 127.0.0.1:${this.port}...`);
    this.controlSocket = await this._connectTcpWithRetry(this.port, 25, 120);
    this.controlSocket.setNoDelay(true); // Disable Nagle's algorithm
    this.controlSocket.setKeepAlive(true, 1000);

    this.controlSocket.on('close', () => {
      console.warn(`[DeviceWorker ${this.serial}] Control socket closed`);
      this.controlSocket = null;
    });

    this.controlSocket.on('error', (err) => {
      console.warn(`[DeviceWorker ${this.serial}] Control socket error: ${err.message}`);
      this.controlSocket = null;
    });
  }

  /**
   * Robust TCP connector with retry backoff
   */
  _connectTcpWithRetry(port, maxAttempts = 30, delayMs = 150) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const attempt = () => {
        attempts++;
        const sock = net.connect({ host: '127.0.0.1', port }, () => {
          sock.removeAllListeners('error');
          resolve(sock);
        });

        sock.once('error', (err) => {
          sock.destroy();
          if (attempts >= maxAttempts) {
            reject(new Error(`Failed to connect to TCP port ${port} after ${attempts} attempts: ${err.message}`));
          } else {
            setTimeout(attempt, delayMs);
          }
        });
      };
      attempt();
    });
  }

  /**
   * v3.3.4 Video Socket Protocol Parser:
   * 1. Initial 77-byte connection metadata:
   *    - 1 byte dummy: 0x00
   *    - 64 bytes: Device name (UTF-8, null-padded)
   *    - 12 bytes video metadata:
   *      - 4 bytes codec_id (u32 BE, 'h264' = 0x68323634)
   *      - 4 bytes width (u32 BE)
   *      - 4 bytes height (u32 BE)
   * 2. Frame packet framing:
   *    - 12 bytes header:
   *      - 8 bytes PTS + flags (u64 BE):
   *        - bit 63 (1n << 63n / 0x80 high byte): FLAG_CONFIG (SPS/PPS)
   *        - bit 62 (1n << 62n / 0x40 high byte): FLAG_KEY_FRAME (IDR Keyframe)
   *        - bits 0..61: PTS in microseconds
   *      - 4 bytes packet_size (u32 BE)
   *    - packet_size bytes raw H.264 NAL units payload
   */
  _setupVideoStreamParser(socket) {
    let accumulated = Buffer.alloc(0);
    let headerParsed = false;
    const INITIAL_HEADER_SIZE = 77;
    const FRAME_HEADER_SIZE = 12;

    socket.on('data', (chunk) => {
      accumulated = accumulated.length === 0 ? chunk : Buffer.concat([accumulated, chunk]);

      // Step 1: Parse 77-byte device metadata header exactly once
      if (!headerParsed) {
        if (accumulated.length < INITIAL_HEADER_SIZE) return; // Wait for full 77 bytes

        const dummyByte = accumulated.readUInt8(0);
        const nameBuf = accumulated.subarray(1, 65);
        const codecId = accumulated.readUInt32BE(65);
        const negotiatedWidth = accumulated.readUInt32BE(69);
        const negotiatedHeight = accumulated.readUInt32BE(73);

        const deviceName = nameBuf.toString('utf-8').replace(/\0/g, '').trim();
        this.deviceMeta.name = deviceName || this.deviceMeta.model;

        if (negotiatedWidth > 0 && negotiatedHeight > 0) {
          this.deviceMeta.width = negotiatedWidth;
          this.deviceMeta.height = negotiatedHeight;
        }

        console.log(`[DeviceWorker ${this.serial}] Handshake OK: Device="${this.deviceMeta.name}", Stream=${this.deviceMeta.width}x${this.deviceMeta.height}, Dummy=0x${dummyByte.toString(16)}`);

        accumulated = accumulated.subarray(INITIAL_HEADER_SIZE);
        headerParsed = true;

        // Broadcast resolution/metadata update to any connected clients
        this._broadcastJson({
          type: 'metadata',
          serial: this.serial,
          model: this.deviceMeta.model,
          name: this.deviceMeta.name,
          width: this.deviceMeta.width,
          height: this.deviceMeta.height,
        });
      }

      // Step 2: Parse raw H.264 frame packets
      while (accumulated.length >= FRAME_HEADER_SIZE) {
        const packetSize = accumulated.readUInt32BE(8);

        // Desync safety guard: if packetSize is corrupted or unreasonably huge
        if (packetSize === 0 || packetSize > 10 * 1024 * 1024) {
          console.warn(`[DeviceWorker ${this.serial}] Frame packet framing error (size=${packetSize}). Resyncing stream...`);
          const syncIndex = accumulated.indexOf(Buffer.from([0, 0, 1]));
          if (syncIndex >= 0) {
            accumulated = accumulated.subarray(Math.max(0, syncIndex - (syncIndex > 0 && accumulated[syncIndex - 1] === 0 ? 1 : 0)));
          } else {
            accumulated = Buffer.alloc(0);
          }
          break;
        }

        if (accumulated.length < FRAME_HEADER_SIZE + packetSize) {
          break; // Frame is still arriving
        }

        // Read PTS flags from first 4 bytes of 64-bit int
        const ptsHigh = accumulated.readUInt32BE(0);
        const isConfig = (ptsHigh & 0x80000000) !== 0; // Bit 63: FLAG_CONFIG (SPS / PPS)
        const isKeyframe = (ptsHigh & 0x40000000) !== 0; // Bit 62: FLAG_KEY_FRAME (IDR slice)

        // Extract raw H.264 NAL unit payload (stripping the 12-byte scrcpy header)
        const payload = accumulated.subarray(FRAME_HEADER_SIZE, FRAME_HEADER_SIZE + packetSize);
        accumulated = accumulated.subarray(FRAME_HEADER_SIZE + packetSize);

        this.lastFrameTime = Date.now();
        this.framesSentCount++;
        this.bytesSentCount += payload.length;

        // Cache configuration & keyframes
        if (isConfig) {
          this.cachedSpsPps = Buffer.from(payload);
        }

        if (isKeyframe) {
          this.cachedKeyframeTime = Date.now();
          // Always ensure the cached keyframe has SPS/PPS attached so WebCodecs decodes frame 1 instantly
          if (this.cachedSpsPps && !this._payloadHasSps(payload)) {
            this.cachedKeyframe = Buffer.concat([this.cachedSpsPps, payload]);
          } else {
            this.cachedKeyframe = Buffer.from(payload);
          }
        }

        // Relay video payload to connected WebSocket clients
        this._broadcastVideoPayload(payload, isKeyframe, isConfig);
      }

      // Buffer overflow prevention
      if (accumulated.length > 2 * 1024 * 1024) {
        console.warn(`[DeviceWorker ${this.serial}] Buffer accumulation overflow. Resetting.`);
        accumulated = Buffer.alloc(0);
      }
    });

    socket.on('close', () => {
      console.warn(`[DeviceWorker ${this.serial}] Video socket closed`);
      this.videoSocket = null;
    });

    socket.on('error', (err) => {
      console.warn(`[DeviceWorker ${this.serial}] Video socket error: ${err.message}`);
      this.videoSocket = null;
    });
  }

  /**
   * Dedicated scrcpy v3.3.4 internal digital audio stream (Opus/AAC/Raw PCM)
   */
  async _startAudioStream(codec = 'opus') {
    if (this._audioProc || this.status === 'stopped') return;
    const audioPort = this.port + 50;
    const scidNum = (this.port * 1000 + 161) & 0x7FFFFFFF;
    const scidHex = scidNum.toString(16).padStart(8, '0');
    this._audioScidHex = scidHex;

    try {
      await this._execAdb(['shell', 'pkill', '-9', '-f', `scid=${scidHex}`]).catch(() => {});
      try { await this._execAdb(['forward', '--remove', `tcp:${audioPort}`]); } catch (_) {}
      await this._execAdb(['forward', `tcp:${audioPort}`, `localabstract:scrcpy_${scidHex}`]);

      const audioArgs = [
        '-s', this.serial, 'shell',
        'CLASSPATH=/data/local/tmp/scrcpy-server.jar',
        'app_process', '/', 'com.genymobile.scrcpy.Server',
        this.config.scrcpyVersion || '3.3.4',
        'tunnel_forward=true',
        `scid=${scidHex}`,
        'video=false',
        'audio=true',
        'control=false',
        `audio_codec=${codec}`,
        'audio_bit_rate=64000',
        'cleanup=false',
      ];

      console.log(`[DeviceWorker ${this.serial}] Spawning scrcpy v3.3.4 internal audio on port ${audioPort}...`);
      const proc = spawn(this.adbBin, audioArgs, { windowsHide: true });
      this._audioProc = proc;

      proc.on('close', () => {
        this._audioProc = null;
        if (this.audioSocket) {
          try { this.audioSocket.destroy(); } catch (_) {}
          this.audioSocket = null;
        }
      });

      // Small pause to allow abstract socket creation
      await new Promise(r => setTimeout(r, 600));
      if (this.status === 'stopped' || !this._audioProc) return;

      this.audioSocket = await this._connectTcpWithRetry(audioPort, 20, 150);
      this.audioSocket.setNoDelay(true);
      this._pipeAudioToClients(this.audioSocket, codec);
      console.log(`[DeviceWorker ${this.serial}] Audio pipeline active on port ${audioPort}`);
    } catch (err) {
      console.warn(`[DeviceWorker ${this.serial}] Audio capture notice: ${err.message} (Video and control unaffected)`);
    }
  }

  _pipeAudioToClients(socket, codec) {
    let buf = Buffer.alloc(0);
    let headerDone = false;
    let detectedCodec = codec;

    socket.on('data', (chunk) => {
      buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);

      if (!headerDone) {
        let offset = 0;
        if (buf.length > 0 && buf[0] === 0x00) offset = 1;
        if (buf.length < offset + 4) return;
        const rawCodec = buf.toString('latin1', offset, offset + 4).toLowerCase().replace(/\0/g, '').trim();
        if (rawCodec.includes('opus')) detectedCodec = 'opus';
        else if (rawCodec.includes('aac')) detectedCodec = 'aac';
        else if (rawCodec.includes('raw')) detectedCodec = 'raw';
        buf = buf.subarray(offset + 4);
        headerDone = true;
      }

      const META = 12; // 8-byte PTS + 4-byte size
      while (buf.length >= META) {
        const pktSize = buf.readUInt32BE(8);
        if (pktSize === 0) {
          buf = buf.subarray(META);
          continue;
        }
        if (pktSize > 512 * 1024) {
          buf = buf.subarray(1);
          continue;
        }
        if (buf.length < META + pktSize) break;

        const isConfig = (buf[0] & 0x80) !== 0;
        const payload = buf.subarray(META, META + pktSize);
        buf = buf.subarray(META + pktSize);

        this._broadcastAudio(payload, detectedCodec, isConfig);
      }
    });

    socket.on('close', () => {
      this.audioSocket = null;
    });
    socket.on('error', () => {
      this.audioSocket = null;
    });
  }

  _broadcastAudio(payload, codec, isConfig) {
    let codecByte = 0x4F; // 'O' = opus
    if (codec === 'aac') codecByte = 0x43; // 'C' = aac
    else if (codec === 'raw') codecByte = 0x52; // 'R' = raw PCM

    const frame = Buffer.allocUnsafe(3 + payload.length);
    frame[0] = 0x41; // 'A' (audio tag)
    frame[1] = codecByte;
    frame[2] = isConfig ? 0x01 : 0x00;
    payload.copy(frame, 3);

    for (const ws of this.wsClients) {
      if (ws.readyState === 1 && ws.bufferedAmount < 64 * 1024) {
        try { ws.send(frame, { binary: true }); } catch (_) {}
      }
    }
  }

  /**
   * Helper to check if an H.264 payload already contains an SPS NAL unit (type 7)
   */
  _payloadHasSps(buf) {
    if (!buf || buf.length < 5) return false;
    for (let i = 0; i < buf.length - 4; i++) {
      if (buf[i] === 0 && buf[i + 1] === 0) {
        if (buf[i + 2] === 1) {
          if ((buf[i + 3] & 0x1f) === 7) return true;
        } else if (buf[i + 2] === 0 && buf[i + 3] === 1) {
          if ((buf[i + 4] & 0x1f) === 7) return true;
        }
      }
    }
    return false;
  }

  /**
   * Broadcasts video payload over WebSocket with backpressure protection:
   * If remote client's buffer exceeds highWaterMark, drop delta frames until next keyframe!
   */
  _broadcastVideoPayload(payload, isKeyframe, isConfig) {
    const highWaterMark = this.config.backpressure?.highWaterMark || 128 * 1024;
    const lowWaterMark = this.config.backpressure?.lowWaterMark || 32 * 1024;

    for (const ws of this.wsClients) {
      if (ws.readyState !== 1) {
        this.wsClients.delete(ws);
        continue;
      }

      // Check client WebSocket backpressure
      if (ws.bufferedAmount > highWaterMark) {
        // Congested client: drop non-keyframe delta frames
        ws._needsKeyframe = true;
        if (!isKeyframe && !isConfig) {
          continue;
        }
      }

      // If client was previously congested, wait until buffer clears AND a Keyframe arrives
      if (ws._needsKeyframe) {
        if (ws.bufferedAmount < lowWaterMark && (isKeyframe || isConfig)) {
          ws._needsKeyframe = false;
          // Prepend cached SPS/PPS if not part of this packet
          if (isKeyframe && !isConfig && this.cachedSpsPps && !this._payloadHasSps(payload)) {
            try { ws.send(this.cachedSpsPps, { binary: true }); } catch (_) {}
          }
        } else {
          continue; // Keep dropping delta frames
        }
      }

      try {
        ws.send(payload, { binary: true });
      } catch (err) {
        this.wsClients.delete(ws);
      }
    }
  }

  /**
   * Registers a new WebSocket browser client:
   * Immediately flushes cached SPS/PPS + IDR Keyframe for zero-latency, artifact-free frame 1!
   */
  addClient(ws) {
    ws._needsKeyframe = false;
    this.wsClients.add(ws);
    console.log(`[DeviceWorker ${this.serial}] Browser client connected (active clients: ${this.wsClients.size})`);

    // 1. Send device metadata header
    try {
      ws.send(JSON.stringify({
        type: 'metadata',
        serial: this.serial,
        model: this.deviceMeta.model,
        name: this.deviceMeta.name,
        width: this.deviceMeta.width,
        height: this.deviceMeta.height,
        fps: this.config.video.maxFps || 60,
      }));
    } catch (_) {}

    // 2. Immediately flush complete cached IDR keyframe (or SPS/PPS) so canvas renders on frame 1 without delay
    if (this.cachedKeyframe && ws.readyState === 1) {
      try {
        ws.send(this.cachedKeyframe, { binary: true });
        console.log(`[DeviceWorker ${this.serial}] Flushed cached keyframe (${this.cachedKeyframe.length} bytes) to new client.`);
      } catch (_) {}
    } else if (this.cachedSpsPps && ws.readyState === 1) {
      try {
        ws.send(this.cachedSpsPps, { binary: true });
      } catch (_) {}
    }

    // 3. Immediately wake up device screen & poke compositor
    this.sendKeycode(224, 0); // KEYCODE_WAKEUP DOWN
    this.sendKeycode(224, 1); // KEYCODE_WAKEUP UP
  }

  /**
   * Deregisters a disconnected WebSocket client
   */
  removeClient(ws) {
    this.wsClients.delete(ws);
    console.log(`[DeviceWorker ${this.serial}] Browser client removed (active clients: ${this.wsClients.size})`);
  }

  /**
   * Broadcasts a JSON message to all clients
   */
  _broadcastJson(obj) {
    const str = JSON.stringify(obj);
    for (const ws of this.wsClients) {
      if (ws.readyState === 1) {
        try { ws.send(str); } catch (_) {}
      }
    }
  }

  // ==========================================================================
  // Binary Control Packet Handlers (Scrcpy v3.3.4 Protocol)
  // ==========================================================================

  /**
   * Handles incoming WebSocket messages from the browser dashboard:
   * Accepts both raw binary scrcpy packets and structured JSON commands.
   */
  handleClientControl(message, ws = null) {
    if (!this.controlSocket || this.controlSocket.destroyed) {
      return false;
    }

    // Direct binary passthrough from browser
    if (Buffer.isBuffer(message) || message instanceof Uint8Array) {
      try {
        this.controlSocket.write(message);
        return true;
      } catch (err) {
        console.warn(`[DeviceWorker ${this.serial}] Binary control write error: ${err.message}`);
        return false;
      }
    }

    // Parse JSON command string
    try {
      const data = typeof message === 'string' ? JSON.parse(message) : message;
      return this._handleJsonControlCommand(data, ws);
    } catch (err) {
      console.warn(`[DeviceWorker ${this.serial}] Invalid control message: ${err.message}`);
      return false;
    }
  }

  /**
   * Routes JSON control actions into binary scrcpy v3.3.4 packets
   */
  _handleJsonControlCommand(data, ws = null) {
    switch (data.type) {
      case 'request_keyframe':
      case 'keyframe':
        if (ws && ws.readyState === 1) {
          if (this.cachedKeyframe) {
            try { ws.send(this.cachedKeyframe, { binary: true }); } catch (_) {}
          } else if (this.cachedSpsPps) {
            try { ws.send(this.cachedSpsPps, { binary: true }); } catch (_) {}
          }
        }
        this.sendKeycode(224, 0); // KEYCODE_WAKEUP DOWN
        this.sendKeycode(224, 1); // KEYCODE_WAKEUP UP
        return true;

      case 'wake':
      case 'refresh':
        this.sendKeycode(224, 0); // KEYCODE_WAKEUP DOWN
        this.sendKeycode(224, 1); // KEYCODE_WAKEUP UP
        return true;
      case 'touch':
        return this.sendTouchEvent(
          data.action, // 0=DOWN, 1=UP, 2=MOVE
          data.x,
          data.y,
          data.width || this.deviceMeta.width,
          data.height || this.deviceMeta.height,
          data.pressure !== undefined ? data.pressure : 1.0
        );

      case 'key':
      case 'keycode':
        return this.sendKeycode(data.keycode, data.action !== undefined ? data.action : 0);

      case 'text':
        return this.sendText(data.text);

      case 'clipboard':
        return this.setClipboard(data.text, data.paste !== false);

      case 'back':
        // Android Keycode 4 = BACK
        this.sendKeycode(4, 0); // DOWN
        this.sendKeycode(4, 1); // UP
        return true;

      case 'home':
        // Android Keycode 3 = HOME
        this.sendKeycode(3, 0);
        this.sendKeycode(3, 1);
        return true;

      case 'app_switch':
      case 'recent':
        // Android Keycode 187 = APP_SWITCH
        this.sendKeycode(187, 0);
        this.sendKeycode(187, 1);
        return true;

      case 'power':
        // Android Keycode 26 = POWER
        this.sendKeycode(26, 0);
        this.sendKeycode(26, 1);
        return true;

      case 'volume_up':
        this.sendKeycode(24, 0);
        this.sendKeycode(24, 1);
        return true;

      case 'volume_down':
        this.sendKeycode(25, 0);
        this.sendKeycode(25, 1);
        return true;

      default:
        return false;
    }
  }

  /**
   * INJECT_TOUCH_EVENT (32 bytes, scrcpy v2+ / v3.3.4 format):
   *  [0]     type = 2
   *  [1]     action: 0=DOWN, 1=UP, 2=MOVE
   *  [2..9]  pointer_id: i64BE (-2n generic finger)
   *  [10..13] x: i32BE
   *  [14..17] y: i32BE
   *  [18..19] screen width: u16BE
   *  [20..21] screen height: u16BE
   *  [22..23] pressure: u16BE (0..0xFFFF)
   *  [24..27] action_button: i32BE (1=PRIMARY on DOWN, 0 otherwise)
   *  [28..31] buttons: i32BE (1 on DOWN/MOVE, 0 on UP)
   */
  sendTouchEvent(action, x, y, width, height, pressure = 1.0) {
    if (!this.controlSocket || this.controlSocket.destroyed) return false;

    const screenW = width || this.deviceMeta.width || 1080;
    const screenH = height || this.deviceMeta.height || 1920;

    const finalX = Math.max(0, Math.min(screenW - 1, Math.round(x)));
    const finalY = Math.max(0, Math.min(screenH - 1, Math.round(y)));
    const normPressure = action === 1 ? 0 : Math.min(0xffff, Math.max(1, Math.floor(pressure * 65535)));

    if (!this._touchBuf) {
      this._touchBuf = Buffer.alloc(32);
    }
    const buf = this._touchBuf;
    buf.writeUInt8(CONTROL_MSG_INJECT_TOUCH_EVENT, 0);
    buf.writeUInt8(action, 1);
    buf.writeBigInt64BE(-2n, 2); // Generic finger pointer ID
    buf.writeInt32BE(finalX, 10);
    buf.writeInt32BE(finalY, 14);
    buf.writeUInt16BE(screenW, 18);
    buf.writeUInt16BE(screenH, 20);
    buf.writeUInt16BE(normPressure, 22);
    buf.writeInt32BE(0, 24); // action_button = 0 (native capacitive touch)
    buf.writeInt32BE(0, 28); // buttons = 0 (direct touch, no mouse emulation delay)

    try {
      this.controlSocket.write(buf);
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * INJECT_KEYCODE (14 bytes):
   *  [0]     type = 0
   *  [1]     action: 0=DOWN, 1=UP
   *  [2..5]  keycode: i32BE
   *  [6..9]  repeat: i32BE
   *  [10..13] metastate: i32BE
   */
  sendKeycode(keycode, action = 0, repeat = 0, metastate = 0) {
    if (!this.controlSocket || this.controlSocket.destroyed) return false;

    const buf = Buffer.allocUnsafe(14);
    buf.writeUInt8(CONTROL_MSG_INJECT_KEYCODE, 0);
    buf.writeUInt8(action, 1);
    buf.writeInt32BE(keycode, 2);
    buf.writeInt32BE(repeat, 6);
    buf.writeInt32BE(metastate, 10);

    try {
      this.controlSocket.write(buf);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * INJECT_TEXT (variable length):
   *  [0]     type = 1
   *  [1..4]  length: i32BE
   *  [5..]   UTF-8 text bytes
   */
  sendText(text) {
    if (!this.controlSocket || this.controlSocket.destroyed || !text) return false;

    const textBuf = Buffer.from(text, 'utf-8');
    const buf = Buffer.allocUnsafe(5 + textBuf.length);
    buf.writeUInt8(CONTROL_MSG_INJECT_TEXT, 0);
    buf.writeInt32BE(textBuf.length, 1);
    textBuf.copy(buf, 5);

    try {
      this.controlSocket.write(buf);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * SET_CLIPBOARD (variable length):
   *  [0]     type = 9
   *  [1..8]  sequence: u64BE
   *  [9]     paste: u8 (1=true, 0=false)
   *  [10..13] length: i32BE
   *  [14..]  UTF-8 text bytes
   */
  setClipboard(text, paste = true) {
    if (!this.controlSocket || this.controlSocket.destroyed) return false;

    const textBuf = Buffer.from(text || '', 'utf-8');
    const buf = Buffer.allocUnsafe(14 + textBuf.length);
    buf.writeUInt8(CONTROL_MSG_SET_CLIPBOARD, 0);
    buf.writeBigUInt64BE(0n, 1); // sequence 0
    buf.writeUInt8(paste ? 1 : 0, 9);
    buf.writeInt32BE(textBuf.length, 10);
    textBuf.copy(buf, 14);

    try {
      this.controlSocket.write(buf);
      return true;
    } catch (_) {
      return false;
    }
  }

  // ==========================================================================
  // Lifecycle & Teardown
  // ==========================================================================

  /**
   * Cleanly terminates the session, closing all sockets, killing remote processes,
   * and clearing ADB port forward rules.
   */
  async stop() {
    if (this._isStopping) return;
    this._isStopping = true;
    this.status = 'stopped';
    console.log(`[DeviceWorker ${this.serial}] Stopping worker and cleaning up resources...`);

    // 1. Notify and close all connected WebSocket clients
    for (const ws of this.wsClients) {
      try {
        ws.close(1001, 'Device disconnected or stream stopped');
      } catch (_) {}
    }
    this.wsClients.clear();

    // 2. Destroy TCP sockets
    this._cleanupSockets();

    // 3. Kill local app_process spawn
    if (this.serverProcess) {
      try {
        this.serverProcess.kill('SIGTERM');
      } catch (_) {}
      this.serverProcess = null;
    }

    // 4. Force kill orphaned scrcpy on device
    try {
      await this._killRemoteZombie();
    } catch (_) {}

    // 5. Remove ADB forward rule so port is immediately freed
    try {
      await this._execAdb(['forward', '--remove', `tcp:${this.port}`]);
    } catch (_) {}

    this.emit('stopped', { serial: this.serial, port: this.port });
    console.log(`[DeviceWorker ${this.serial}] Worker teardown complete.`);
  }

  _cleanupSockets() {
    if (this._audioProc) {
      try { this._audioProc.kill('SIGTERM'); } catch (_) {}
      this._audioProc = null;
    }
    if (this._audioScidHex) {
      this._execAdb(['shell', 'pkill', '-9', '-f', `scid=${this._audioScidHex}`]).catch(() => {});
    }
    if (this.audioSocket) {
      try { this.audioSocket.destroy(); } catch (_) {}
      this.audioSocket = null;
    }
    if (this.videoSocket) {
      try { this.videoSocket.destroy(); } catch (_) {}
      this.videoSocket = null;
    }
    if (this.controlSocket) {
      try { this.controlSocket.destroy(); } catch (_) {}
      this.controlSocket = null;
    }
  }

  _execAdb(args) {
    return new Promise((resolve, reject) => {
      execFile(this.adbBin, ['-s', this.serial, ...args], { timeout: 12000, windowsHide: true }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout || '');
      });
    });
  }

  /**
   * Returns current worker summary for cloud sync
   */
  getSummary() {
    return {
      serial: this.serial,
      model: this.deviceMeta.model,
      name: this.deviceMeta.name,
      resolution: `${this.deviceMeta.width}x${this.deviceMeta.height}`,
      width: this.deviceMeta.width,
      height: this.deviceMeta.height,
      battery: this.deviceMeta.battery,
      port: this.port,
      streamStatus: this.status === 'running' ? 'streaming' : this.status,
      clientsConnected: this.wsClients.size,
      fps: this.config.video.maxFps || 60,
      bitrate: this.config.video.videoBitRate || 4000000,
      framesSent: this.framesSentCount,
      bytesSent: this.bytesSentCount,
      lastFrameTime: this.lastFrameTime,
    };
  }
}

module.exports = DeviceWorker;

