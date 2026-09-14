'use strict';

/**
 * DeviceFarm Auto-Enrollment & Reboot Recovery Service
 * ─────────────────────────────────────────────────────
 * Background process that:
 * 1. Polls ADB every 10 seconds for any newly connected / rebooted devices
 * 2. Cross-checks with active processManager sessions
 * 3. Auto re-provisions any device found in ADB that is NOT actively streamed
 * 4. Cleans up stale processManager entries for devices no longer in ADB
 *
 * This runs ALONGSIDE the event-driven adb-tracker so that even if a
 * device silently reboots (no ADB disconnect event fired), it gets
 * picked up and re-enrolled within ~10 seconds.
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const processManager = require('../main/process-manager');

// ─── Config ──────────────────────────────────────────────────────────────────

function loadConfig() {
  for (const p of [
    path.join(process.cwd(), 'config.json'),
    path.join(__dirname, '..', '..', 'config.json'),
  ]) {
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (_) {}
    }
  }
  return {};
}

function resolveAdb() {
  const cfg = loadConfig();
  if (cfg.adbPath && fs.existsSync(cfg.adbPath)) return cfg.adbPath;
  const bundled = path.join(__dirname, '../../assets/bin/adb.exe');
  if (fs.existsSync(bundled)) return bundled;
  if (fs.existsSync('C:\\platform-tools\\adb.exe')) return 'C:\\platform-tools\\adb.exe';
  return 'adb';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function listAdbDevices(adbBin) {
  return new Promise((resolve) => {
    exec(`"${adbBin}" devices`, { timeout: 7000 }, (err, stdout, stderr) => {
      const out = ((stdout || '') + ' ' + (stderr || '')).toLowerCase();
      // If ADB daemon cannot connect, hangs, or crashes, auto-heal immediately
      if (err && (out.includes('cannot connect to daemon') || out.includes('could not read ok') || err.killed || out.includes('failed to start daemon'))) {
        logger.warn('[EnrollmentGuard] ADB daemon unresponsive or in bad state. Auto-restarting ADB daemon...');
        try {
          if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            try { execSync('taskkill /F /IM adb.exe >nul 2>&1', { timeout: 3000, stdio: 'ignore' }); } catch (_) {}
            try { execSync(`"${adbBin}" start-server >nul 2>&1`, { timeout: 5000, stdio: 'ignore' }); } catch (_) {}
          }
        } catch (_) {}
        resolve([]);
        return;
      }
      if (err) { resolve([]); return; }
      const lines = (stdout || '').split('\n').slice(1);
      const serials = [];
      let hasOffline = false;
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          if (parts[1] === 'device') {
            serials.push(parts[0]);
          } else if (parts[1] === 'offline') {
            hasOffline = true;
          }
        }
      }
      if (hasOffline) {
        try {
          exec(`"${adbBin}" reconnect offline`, { timeout: 3000 }, () => {});
        } catch (_) {}
      }
      resolve(serials);
    });
  });
}

// ─── Main Loop ────────────────────────────────────────────────────────────────

let _addDeviceCallback = null;
let _removeDeviceCallback = null;
let _intervalTimer = null;
const _inProgress = new Set();

/**
 * Start the recovery polling loop.
 * @param {Function} onDeviceAdd    – same handler as adb-tracker's handleDeviceAdd
 * @param {Function} onDeviceRemove – same handler as adb-tracker's handleDeviceRemove
 * @param {number} intervalMs      – polling interval, default 12000ms
 */
function startEnrollmentGuard(onDeviceAdd, onDeviceRemove, intervalMs = 12000) {
  _addDeviceCallback = onDeviceAdd;
  _removeDeviceCallback = onDeviceRemove;

  if (_intervalTimer) clearInterval(_intervalTimer);

  logger.info('[EnrollmentGuard] Auto-enrollment recovery service started');

  _intervalTimer = setInterval(async () => {
    try {
      await runRecoveryCheck();
    } catch (err) {
      logger.warn(`[EnrollmentGuard] Recovery check error: ${err.message}`);
    }
  }, intervalMs);
}

let lastWifiProbeTime = 0;
const WIFI_PROBE_INTERVAL_MS = 60000;

async function connectFarmWifiDevices(adbBin, existingSerials) {
  if (Date.now() - lastWifiProbeTime < WIFI_PROBE_INTERVAL_MS) {
    return;
  }
  lastWifiProbeTime = Date.now();

  const farmIps = [
    '10.1.10.79', '10.1.10.197', '10.1.10.173', '10.1.10.124',
    '10.1.10.23', '10.1.10.49', '10.1.10.100', '10.1.10.194', '10.1.10.98'
  ];
  const activeKeys = new Set(processManager.getActiveSerials());
  const net = require('net');
  for (const ip of farmIps) {
    const target = `${ip}:5555`;
    if (existingSerials.includes(target) || activeKeys.has(target)) continue;
    // Fast TCP probe to avoid blocking if IP is offline
    const isOpen = await new Promise((res) => {
      const s = net.connect({ host: ip, port: 5555 }, () => { s.destroy(); res(true); });
      s.on('error', () => { s.destroy(); res(false); });
      s.setTimeout(400, () => { s.destroy(); res(false); });
    });
    if (isOpen) {
      exec(`"${adbBin}" connect ${target}`, { timeout: 3000 }, () => {});
    }
  }
}

async function runRecoveryCheck() {
  const adbBin = resolveAdb();
  const adbSerials = await listAdbDevices(adbBin);
  const activeSerials = new Set(processManager.getActiveSerials());

  // Auto-connect any reachable farm devices on WiFi
  try {
    await connectFarmWifiDevices(adbBin, adbSerials);
  } catch (_) {}

  // ── 1. Re-enroll devices seen by ADB but not actively streaming ─────────────
  for (const serial of adbSerials) {
    if (activeSerials.has(serial) || processManager.getDevice(serial)) continue;      // Already streaming or tracked ✓
    if (_inProgress.has(serial)) continue;         // Already being provisioned ✓

    logger.info(`[EnrollmentGuard] Re-enrolling rebooted/reconnected device: ${serial}`);
    _inProgress.add(serial);

    try {
      await _addDeviceCallback({ id: serial, type: 'device' });
    } catch (err) {
      logger.warn(`[EnrollmentGuard] Re-enrollment failed for ${serial}: ${err.message}`);
    } finally {
      _inProgress.delete(serial);
    }
  }

  // ── 2. Clean up stale processManager entries for vanished devices ───────────
  for (const serial of activeSerials) {
    if (adbSerials.includes(serial)) continue;    // Still directly in ADB ✓

    // Prevent killing sessions that are active under their ADB endpoint (e.g. WiFi IP)
    const session = processManager.getDevice(serial);
    if (session) {
      if (session.adbSerial && adbSerials.includes(session.adbSerial)) continue;
      if (session.serial && adbSerials.includes(session.serial)) continue;
    }

    logger.info(`[EnrollmentGuard] Stale session detected for ${serial} — cleaning up`);
    try {
      if (_removeDeviceCallback) {
        await _removeDeviceCallback({ id: serial });
      } else {
        processManager.killDeviceProcesses(serial);
      }
    } catch (err) {
      logger.warn(`[EnrollmentGuard] Cleanup error for ${serial}: ${err.message}`);
    }
  }
}

function stopEnrollmentGuard() {
  if (_intervalTimer) {
    clearInterval(_intervalTimer);
    _intervalTimer = null;
    logger.info('[EnrollmentGuard] Auto-enrollment recovery service stopped');
  }
}

module.exports = { startEnrollmentGuard, stopEnrollmentGuard, runRecoveryCheck };
