'use strict';

/**
 * Device anti-detection, physical simulation & bootloader hiding service.
 * ──────────────────────────────────────────────────────────────────────────
 * Configures connected Android devices so survey & earning apps
 * (e.g. Swagbucks, Freecash, AttaPoll, InboxDollars, Qmee) do not flag or block
 * the device due to remote control, unlocked bootloaders, or location/accessibility detection.
 *
 * IMPORTANT: adb_enabled and development_settings_enabled MUST stay ENABLED (1)
 * so that ADB communication and scrcpy engine remain 100% functional.
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

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

/**
 * Execute adb shell command on a specific device serial.
 */
function execAdbShell(serial, cmd, timeoutMs = 5000) {
  const adbBin = resolveAdb();
  return new Promise((resolve) => {
    const fullCmd = `"${adbBin}" -s ${serial} shell "${cmd.replace(/"/g, '\\"')}"`;
    exec(fullCmd, { windowsHide: true, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        resolve({ success: false, error: err.message, stdout: stdout || '' });
      } else {
        resolve({ success: true, stdout: (stdout || '').trim() });
      }
    });
  });
}

/**
 * Grant app permissions with simulated UI interaction delays.
 * Real permission grants show UI dialog (200-500ms), then system confirmation.
 * Instant grants are detectable as automation.
 */
async function grantAppPermissions(serial, packageName, permissions = []) {
  const adbBin = resolveAdb();
  
  // Randomize permission grant order to avoid predictable patterns
  const shuffled = [...permissions].sort(() => Math.random() - 0.5);
  
  for (const permission of shuffled) {
    // Simulate UI dialog interaction delay (200-500ms before granting)
    const uiDelay = Math.random() * 300 + 200;
    await new Promise(r => setTimeout(r, uiDelay));
    
    const cmd = `pm grant ${packageName} ${permission}`;
    await execAdbShell(serial, cmd);
    
    logger.info(`[StealthService] Permission granted (${packageName}/${permission.split('.').pop()}) after ${Math.round(uiDelay)}ms UI delay`);
  }
  
  return true;
}

/**
 * Applies comprehensive anti-detection & physical device simulation to an Android device.
 * @param {string} serial - Device ADB serial number
 */
async function applyDeviceStealth(serial, stealthRootEnabled = true) {
  if (stealthRootEnabled === false) {
    logger.info(`[StealthService] Stealth Root disabled by admin for device ${serial}. Skipping root masking.`);
    return false;
  }

  logger.info(`[StealthService] Applying bootloader hiding, remote-control masking & physical simulation for device: ${serial}...`);

  // 1. Ensure ADB and Developer Settings remain ENABLED (1) for scrcpy engine stability
  // 2. Hide touch/pointer overlays and non-essential debug indicators
  const settingsCmds = [
    'settings put global adb_enabled 1',
    'settings put global development_settings_enabled 1',
    'settings put secure mock_location 0',
    'settings put global package_verifier_enable 1',
    'settings put system show_touches 0',
    'settings put global stay_awake 3',
    'settings put system stay_awake 3',
    'svc power stayon true',
    'input keyevent 224',
    'input keyevent 82',
  ];

  // 3. Hide Remote Control & Accessibility Service flags & Input Method automation signatures
  const remoteControlCmds = [
    'settings put secure accessibility_enabled 0',
    'settings put secure enabled_accessibility_services ""',
    'settings put global remote_control_enabled 0',
    'settings put secure remote_control_enabled 0',
    'settings put secure touch_exploration_enabled 0',
    'settings put secure set_accessibility_services_ready 1',
  ];

  // 4. Enforce Real Physical Location & Network Time Consistency
  const locationCmds = [
    'settings put secure location_mode 3',
    'settings put secure location_providers_allowed +gps,network',
    'settings put global auto_time 1',
    'settings put global auto_time_zone 1',
  ];

  // 5. Simulate Real Physical Battery (Discharging handheld status instead of USB device farm PC connection)
  const batteryCmds = [];  // Disabled — don't interfere with charging

  const allCmds = [...settingsCmds, ...remoteControlCmds, ...locationCmds, ...batteryCmds];
  for (const cmd of allCmds) {
    await execAdbShell(serial, cmd);
  }

  // 6. Hide Unlocked Bootloader, Root & Emulator Build Indicators
  const propConfigs = [
    { key: 'ro.boot.flash.locked', value: '1' },
    { key: 'ro.boot.verifiedbootstate', value: 'green' },
    { key: 'ro.boot.veritymode', value: 'enforcing' },
    { key: 'ro.secure', value: '1' },
    { key: 'ro.debuggable', value: '0' },
    { key: 'ro.build.type', value: 'user' },
    { key: 'ro.build.tags', value: 'release-keys' },
    { key: 'ro.boot.bootloader', value: 'locked' },
    { key: 'vendor.boot.verifiedbootstate', value: 'green' },
    { key: 'sys.oem_unlock_allowed', value: '0' },
    { key: 'ro.kernel.qemu', value: '0' },
  ];

  // Try resetprop via su first (for Magisk / KernelSU / APatch rooted devices)
  const resetpropCmds = propConfigs.map(p => `resetprop ${p.key} ${p.value}`).join('; ');
  const setpropCmds   = propConfigs.map(p => `setprop ${p.key} ${p.value}`).join('; ');

  const suRes = await execAdbShell(serial, `su -c "${resetpropCmds}"`);
  if (!suRes.success) {
    const directReset = await execAdbShell(serial, resetpropCmds);
    if (!directReset.success) {
      await execAdbShell(serial, setpropCmds);
    }
  }

  logger.info(`[StealthService] ✅ Bootloader, remote-control masking & physical simulation active on device ${serial}`);
  return true;
}

module.exports = {
  applyDeviceStealth,
  grantAppPermissions,
  execAdbShell,
};
