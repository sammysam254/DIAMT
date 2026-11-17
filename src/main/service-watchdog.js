'use strict';

/**
 * DeviceFarm Agent — Autonomous Background Service Watchdog
 *
 * Supervises the DeviceFarm Agent process. If the agent crashes, is closed,
 * or terminates unexpectedly, the watchdog automatically relaunches it
 * after a 3-second delay, ensuring 24/7 continuous unattended operation.
 */

const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn, execSync } = require('child_process');

// ── Single Instance Guard (Port 7402) ─────────────────────────
const lockServer = net.createServer();
lockServer.once('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Another watchdog instance is already active. Exit quietly.
    process.exit(0);
  }
});
lockServer.listen(7402, '127.0.0.1');

const rootDir = path.resolve(__dirname, '..', '..');
let activeChild = null;
let restartCount = 0;
let isStopping = false;

function preLaunchCleanup() {
  try {
    // Permanently remove any legacy cache file if created
    const wifiCache = path.join(rootDir, 'wifi-devices-cache.json');
    if (fs.existsSync(wifiCache)) {
      try { fs.unlinkSync(wifiCache); } catch (_) {}
    }
  } catch (_) {}
}

function getElectronPath() {
  const localElectron = path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron.exe');
  if (fs.existsSync(localElectron)) {
    return localElectron;
  }
  return 'electron';
}

function startAgent() {
  if (isStopping) return;

  preLaunchCleanup();

  const electronExe = getElectronPath();
  const mainScript = path.join(rootDir, 'src', 'main', 'index.js');

  const args = [mainScript, '--hidden'];

  try {
    activeChild = spawn(electronExe, args, {
      cwd: rootDir,
      windowsHide: true,
      stdio: 'ignore',
      detached: false,
      env: { ...process.env, BACKGROUND_SERVICE: '1' }
    });

    activeChild.on('error', (err) => {
      // Avoid crash on spawn error, retry after delay
      scheduleRestart();
    });

    activeChild.on('exit', (code, signal) => {
      activeChild = null;
      if (!isStopping) {
        scheduleRestart();
      }
    });
  } catch (err) {
    scheduleRestart();
  }
}

function scheduleRestart() {
  if (isStopping) return;
  restartCount++;
  // Exponential backoff up to 10 seconds if restarting rapidly
  const delay = Math.min(3000 + (restartCount > 5 ? 7000 : 0), 10000);
  setTimeout(() => {
    startAgent();
  }, delay);
}

// Handle termination signals cleanly
process.on('SIGINT', () => {
  isStopping = true;
  if (activeChild) {
    try { activeChild.kill(); } catch (_) {}
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  isStopping = true;
  if (activeChild) {
    try { activeChild.kill(); } catch (_) {}
  }
  process.exit(0);
});

// Start the initial supervised agent process
startAgent();
