'use strict';

/**
 * ============================================================================
 * Production Host Bridge Configuration for scrcpy-server v3.3.4
 * ============================================================================
 * Resolves paths dynamically across Windows host directories:
 *  - User Downloads folder (where scrcpy-win64-v3.3.4 is downloaded)
 *  - C:\scrcpy-win64-v3.3.4
 *  - Local project directory
 *  - Auto-extracts scrcpy-win64-v3.3.4.zip if unextracted in Downloads
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

/**
 * Attempts to automatically extract scrcpy-win64-v3.3.4.zip if the folder does not exist yet.
 */
function tryAutoExtract(zipPath, targetDir) {
  if (fs.existsSync(zipPath) && !fs.existsSync(targetDir)) {
    try {
      console.log(`[Config] Found archive "${zipPath}". Extracting to "${targetDir}"...`);
      const parentDir = path.dirname(targetDir);
      if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
      execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${parentDir}' -Force"`, {
        windowsHide: true,
        timeout: 60000,
        stdio: 'ignore'
      });
      console.log(`[Config] Auto-extracted scrcpy package successfully.`);
    } catch (err) {
      console.warn(`[Config] Auto-extract notice: ${err.message}`);
    }
  }
}

/**
 * Resolves the root directory of the scrcpy-win64-v3.3.4 installation.
 */
function isValidScrcpyDir(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  return (
    fs.existsSync(path.join(dir, 'scrcpy.exe')) ||
    fs.existsSync(path.join(dir, 'scrcpy-server')) ||
    fs.existsSync(path.join(dir, 'scrcpy-server.jar')) ||
    fs.existsSync(path.join(dir, 'adb.exe'))
  );
}

function resolveScrcpyDir() {
  const home = os.homedir();
  const downloadsDir = path.join(home, 'Downloads');
  const targetFolderName = 'scrcpy-win64-v3.3.4';
  const targetZipName = 'scrcpy-win64-v3.3.4.zip';

  // Check Downloads zip and try auto-extract
  const downloadZipPath = path.join(downloadsDir, targetZipName);
  const downloadTargetDir = path.join(downloadsDir, targetFolderName);
  tryAutoExtract(downloadZipPath, downloadTargetDir);

  // Check C:\ zip and cwd zip
  const cZipPath = path.join('C:\\', targetZipName);
  const cTargetDir = path.join('C:\\', targetFolderName);
  tryAutoExtract(cZipPath, cTargetDir);

  const localZipPath = path.join(process.cwd(), targetZipName);
  const localTargetDir = path.join(process.cwd(), targetFolderName);
  tryAutoExtract(localZipPath, localTargetDir);

  const candidates = [
    process.env.SCRCPY_DIR,
    path.join(downloadsDir, targetFolderName),
    path.join(downloadsDir, 'scrcpy'),
    cTargetDir,
    'C:\\scrcpy',
    localTargetDir,
    path.join(__dirname, targetFolderName),
    path.join(__dirname, 'DIAMT', targetFolderName),
    path.join(home, targetFolderName),
    'C:\\DeviceFarmAgent\\scrcpy-win64-v3.3.4',
    'C:\\DeviceFarmAgent',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (isValidScrcpyDir(candidate)) {
      return candidate;
    }
  }

  // Fallback to Downloads path even if pending download/unzip
  return path.join(downloadsDir, targetFolderName);
}

const SCRCPY_DIR = resolveScrcpyDir();

/**
 * Resolves path to adb.exe
 */
function resolveAdbPath() {
  const candidates = [
    process.env.ADB_PATH,
    path.join(SCRCPY_DIR, 'adb.exe'),
    path.join(os.homedir(), 'Downloads', 'scrcpy-win64-v3.3.4', 'adb.exe'),
    path.join('C:\\scrcpy-win64-v3.3.4', 'adb.exe'),
    path.join(process.cwd(), 'assets', 'bin', 'adb.exe'),
    path.join(__dirname, 'DIAMT', 'assets', 'bin', 'adb.exe'),
    'C:\\platform-tools\\adb.exe',
    'C:\\DeviceFarmAgent\\assets\\bin\\adb.exe',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return 'adb.exe'; // rely on system PATH
}

/**
 * Resolves path to scrcpy-server binary (official v3.3.4)
 */
function resolveScrcpyServerPath() {
  const candidates = [
    process.env.SCRCPY_SERVER_PATH,
    path.join(SCRCPY_DIR, 'scrcpy-server'),
    path.join(SCRCPY_DIR, 'scrcpy-server.jar'),
    path.join(os.homedir(), 'Downloads', 'scrcpy-win64-v3.3.4', 'scrcpy-server'),
    path.join(os.homedir(), 'Downloads', 'scrcpy-win64-v3.3.4', 'scrcpy-server.jar'),
    path.join('C:\\scrcpy-win64-v3.3.4', 'scrcpy-server'),
    path.join('C:\\scrcpy-win64-v3.3.4', 'scrcpy-server.jar'),
    path.join(process.cwd(), 'scrcpy-server.jar'),
    path.join(process.cwd(), 'scrcpy-server'),
    path.join(__dirname, 'scrcpy-server.jar'),
    path.join(__dirname, 'DIAMT', 'scrcpy-server.jar'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return path.join(SCRCPY_DIR, 'scrcpy-server');
}

/**
 * Load optional cloud/host config if existing config.json is present
 */
function loadExistingJsonConfig() {
  const candidates = [
    path.join(process.cwd(), 'config.json'),
    path.join(__dirname, 'config.json'),
    path.join(__dirname, 'DIAMT', 'config.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      } catch (_) {}
    }
  }
  return {};
}

const existingConfig = loadExistingJsonConfig();

module.exports = {
  // Binary Paths
  scrcpyDir: SCRCPY_DIR,
  adbPath: resolveAdbPath(),
  scrcpyServerPath: resolveScrcpyServerPath(),

  // Local Forwarding TCP Port Range for ADB tunnels
  basePort: parseInt(process.env.SCRCPY_BASE_PORT, 10) || 27183,
  maxPort: parseInt(process.env.SCRCPY_MAX_PORT, 10) || 27999,

  // Host Bridge HTTP & WebSocket Server Port
  serverPort: parseInt(process.env.PORT, 10) || 8090,
  serverHost: process.env.HOST || '0.0.0.0',

  // scrcpy-server v3.3.4 Parameters
  scrcpyVersion: '3.3.4',
  video: {
    maxSize: parseInt(process.env.SCRCPY_MAX_SIZE, 10) || 1080,
    videoBitRate: parseInt(process.env.SCRCPY_BIT_RATE, 10) || 4000000, // 4 Mbps
    maxFps: parseInt(process.env.SCRCPY_MAX_FPS, 10) || 60,
    iFrameInterval: parseInt(process.env.SCRCPY_I_FRAME_INTERVAL, 10) || 2, // 2-second keyframes
    tunnelForward: true,
    audio: false,
    control: true,
    cleanup: false,
  },

  // Backpressure & Latency Drift Protection
  backpressure: {
    // If client WebSocket bufferedAmount exceeds highWaterMark, drop delta P-frames
    highWaterMark: 128 * 1024, // 128 KB
    // Only resume sending frames when bufferedAmount drains below lowWaterMark AND on Keyframe
    lowWaterMark: 32 * 1024,   // 32 KB
  },

  // Cloud Rental Dashboard Sync & Heartbeat
  cloudDashboard: {
    webhookUrl: process.env.DASHBOARD_WEBHOOK_URL || existingConfig.centralApiUrl || '',
    heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS, 10) || existingConfig.heartbeatIntervalMs || 10000,
    apiKey: process.env.DASHBOARD_API_KEY || existingConfig.agentSecretKey || '',
    agentBindingCode: existingConfig.machineBindingCode || '',
  },

  // Security / Auth
  auth: {
    requireToken: process.env.REQUIRE_AUTH === 'true',
    jwtSecret: process.env.JWT_SECRET || 'scrcpy-bridge-secret-key',
  },
};
