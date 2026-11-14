'use strict';

const http = require('http');
const WebSocket = require('ws');
const { spawn, exec, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const ScrcpyEngine = require('./scrcpy-engine');
const bindingService = require('./binding-service');
const licenseService = require('./license-service');
const cache = require('./cache-service');

// ─── Config & ADB ────────────────────────────────────────────────────────────

function loadConfig() {
  for (const p of [path.join(process.cwd(), 'config.json'), path.join(__dirname, '..', '..', 'config.json')]) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  }
  return {};
}
const config = loadConfig();

function resolveAdbBin() {
  if (config.adbPath && fs.existsSync(config.adbPath)) return config.adbPath;
  const b = path.join(__dirname, '../../assets/bin/adb.exe');
  if (fs.existsSync(b)) return b;
  if (fs.existsSync('C:\\platform-tools\\adb.exe')) return 'C:\\platform-tools\\adb.exe';
  return 'adb';
}
const ADB_BIN = resolveAdbBin();

const activeServers = new Map();

// ── Kill Switch Global State ────────────────────────────────────────────────
let _isKillSwitchActive = false;

function isKillSwitchActive() {
  return _isKillSwitchActive;
}

function setKillSwitchActive(active) {
  _isKillSwitchActive = Boolean(active);
  logger.info(`[StreamService] Kill switch state updated: ${_isKillSwitchActive ? 'ACTIVE (holding streams with revoked licence screen & freezing controls)' : 'OFF (streams live)'}`);

  // Broadcast kill switch state to all unique active sessions across all devices
  const uniqueSessions = new Set(activeServers.values());
  for (const session of uniqueSessions) {
    if (session.engine) {
      session.engine.paused = _isKillSwitchActive;
      if (_isKillSwitchActive) {
        // Immediately sever all video/audio clients attached to engine
        for (const ws of session.engine.wsClients) {
          try { ws.send(JSON.stringify({ type: 'kill_switch', active: true })); } catch (_) {}
          try { ws.send(JSON.stringify({ type: 'stream_revoked', reason: 'kill_switch' })); } catch (_) {}
          try { ws.close(4003, 'Licence Permanently Revoked'); } catch (_) {}
        }
        session.engine.wsClients.clear();
      }
    }
    if (session.wss && session.wss.clients) {
      const payload = JSON.stringify({ type: 'kill_switch', active: _isKillSwitchActive });
      for (const client of session.wss.clients) {
        if (client.readyState === 1 /* WebSocket.OPEN */) {
          try { client.send(payload); } catch (_) {}
          if (_isKillSwitchActive) {
            try { client.send(JSON.stringify({ type: 'stream_revoked', reason: 'kill_switch' })); } catch (_) {}
            try { client.close(4003, 'Licence Permanently Revoked'); } catch (_) {}
          }
        }
      }
    }
  }
}

// ── Continuous Supabase Database Sync for Kill Switch ───────────────────────
const SUPABASE_KS_URL = 'https://xbolsgcntkfzzpqnulsa.supabase.co';
const SUPABASE_KS_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhib2xzZ2NudGtmenpwcW51bHNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3OTU2NTAsImV4cCI6MjEwNTM3MTY1MH0.u18WPrgklzJM2kCk4-OxGKoecSuUx4BuOitHrXQNUIk';

async function syncKillSwitchFromDb() {
  try {
    const r = await fetch(SUPABASE_KS_URL + '/rest/v1/system_kill_switch?id=eq.1&select=is_active', {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
      headers: { 'apikey': SUPABASE_KS_KEY, 'Authorization': 'Bearer ' + SUPABASE_KS_KEY }
    });
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length > 0 && typeof rows[0].is_active !== 'undefined') {
        const dbState = Boolean(rows[0].is_active);
        if (dbState !== _isKillSwitchActive) {
          setKillSwitchActive(dbState);
        }
      }
    }
  } catch (_) {}
}
setInterval(syncKillSwitchFromDb, 500); // 500ms poll for near-instant kill switch enforcement
syncKillSwitchFromDb();


function findActiveSession(reqUdid, fallbackSerial) {
  if (!reqUdid && fallbackSerial) return activeServers.get(fallbackSerial) || null;
  if (!reqUdid) return activeServers.values().next().value || null;

  const raw = String(reqUdid).trim();
  // 1. Direct exact match
  if (activeServers.has(raw)) return activeServers.get(raw);

  // 2. Case-insensitive match
  const lower = raw.toLowerCase();
  for (const [k, v] of activeServers.entries()) {
    if (k.toLowerCase() === lower) return v;
  }

  // 3. OCR-safe normalized match (e.g. 0B0FP... vs OBOFP... where 0/O and 1/I/L are interchangeable)
  const normalize = s => s.toUpperCase().replace(/0/g, 'O').replace(/[1L]/g, 'I');
  const normReq = normalize(raw);
  for (const [k, v] of activeServers.entries()) {
    if (normalize(k) === normReq) return v;
  }

  // 4. Substring / partial match
  for (const [k, v] of activeServers.entries()) {
    if (k.includes(raw) || raw.includes(k)) return v;
  }

  // 5. Fallback to fallbackSerial if valid
  if (fallbackSerial && activeServers.has(fallbackSerial)) {
    return activeServers.get(fallbackSerial);
  }

  // 6. Graceful single-device fallback: if only 1 device is active, stream it rather than showing offline
  if (activeServers.size === 1) {
    return activeServers.values().next().value;
  }

  return null;
}

// ─── Persistent ADB input shell (fallback when scrcpy not ready) ─────────────

const inputShells = new Map();
function getInputShell(serial) {
  const ex = inputShells.get(serial);
  if (ex && ex.stdin && !ex.stdin.destroyed) return ex;
  const p = spawn(ADB_BIN, ['-s', serial, 'shell'], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
  if (p.stdin) try { p.stdin.setNoDelay(true); } catch (_) {}
  p.on('error', () => inputShells.delete(serial));
  p.on('close', () => inputShells.delete(serial));
  inputShells.set(serial, p);
  return p;
}
function adbInput(serial, cmd) {
  try { getInputShell(serial).stdin.write(cmd + '\n'); }
  catch (_) { exec(`"${ADB_BIN}" -s ${serial} shell ${cmd}`); }
}

// ─── Payment-blocked HTML ────────────────────────────────────────────────────

function getStreamBlockedHtml(serial, checkoutUrl, s = {}) {
  const fee = s.monthlyFee || 30;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Stream Blocked</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#060911;color:#f8fafc;font-family:system-ui;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.card{background:#0f172a;border:1px solid rgba(239,68,68,.45);border-radius:24px;padding:40px 32px;max-width:520px;width:100%;text-align:center}.price{font-size:46px;font-weight:800;color:#38bdf8;margin:12px 0 4px}.btn{display:block;width:100%;padding:15px;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;text-decoration:none;font-weight:700;border-radius:14px;font-size:15px;border:none;cursor:pointer;margin-top:16px}</style>
</head><body><div class="card">
<div style="font-size:28px;margin-bottom:12px">🔒</div>
<h2>Monthly Rental Payment Required</h2>
<div class="price">$${fee}.00 USD</div>
<p style="color:#94a3b8;margin:8px 0 16px">Device: <code>${serial}</code></p>
<a href="${checkoutUrl}" target="_blank" class="btn">💳 Pay to Unlock Stream</a>
<button onclick="location.reload()" class="btn" style="background:rgba(255,255,255,.08);color:#94a3b8;margin-top:8px">🔄 Refresh</button>
</div></body></html>`;
}

// ─── Screencap fallback (one-shot, for /screen.jpg HTTP endpoint) ────────────

function getStreamKillSwitchRevokedHtml(serial) {
  const safeSerial = serial ? String(serial).replace(/"/g, '&quot;') : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LICENCE PERMANENTLY REVOKED</title>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      min-height: 100vh;
      background: #080202;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
      overflow: hidden;
      user-select: none;
    }
    .glow-blob {
      position: absolute;
      width: 600px;
      height: 600px;
      border-radius: 50%;
      background: rgba(220, 38, 38, 0.22);
      filter: blur(140px);
      animation: pulseGlow 1.8s infinite alternate ease-in-out;
      pointer-events: none;
    }
    @keyframes pulseGlow {
      0% { opacity: 0.3; transform: scale(0.85); }
      100% { opacity: 0.85; transform: scale(1.15); }
    }
    .card {
      position: relative;
      z-index: 2;
      max-width: 580px;
      width: 100%;
      background: rgba(15, 3, 3, 0.94);
      border: 2px solid rgba(239, 68, 68, 0.7);
      border-radius: 28px;
      padding: 48px 36px;
      text-align: center;
      box-shadow: 0 0 60px rgba(220, 38, 38, 0.45), 0 0 120px rgba(220, 38, 38, 0.15);
      animation: borderPulse 1.8s infinite alternate ease-in-out;
    }
    @keyframes borderPulse {
      0% { border-color: rgba(239, 68, 68, 0.4); box-shadow: 0 0 30px rgba(220, 38, 38, 0.25); }
      100% { border-color: rgba(239, 68, 68, 1); box-shadow: 0 0 80px rgba(220, 38, 38, 0.65); }
    }
    .danger-icon-box {
      width: 90px;
      height: 90px;
      border-radius: 50%;
      background: rgba(239, 68, 68, 0.15);
      border: 3px solid #ef4444;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
      animation: iconBounce 1.5s infinite ease-in-out;
    }
    @keyframes iconBounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-8px); }
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(239, 68, 68, 0.16);
      border: 1px solid rgba(239, 68, 68, 0.45);
      border-radius: 20px;
      padding: 4px 14px;
      color: #f87171;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 1.5px;
      margin-bottom: 18px;
      text-transform: uppercase;
    }
    .title {
      font-size: 28px;
      font-weight: 900;
      color: #ef4444;
      letter-spacing: -0.5px;
      line-height: 1.2;
      margin-bottom: 16px;
      text-shadow: 0 0 30px rgba(239, 68, 68, 0.7);
      animation: titlePulse 1.8s infinite alternate ease-in-out;
    }
    @keyframes titlePulse {
      0% { opacity: 0.85; transform: scale(0.99); }
      100% { opacity: 1; transform: scale(1.02); }
    }
    .desc {
      color: #fca5a5;
      font-size: 14.5px;
      line-height: 1.6;
      margin-bottom: 24px;
      font-weight: 500;
    }
    .status-box {
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 14px;
      padding: 14px 18px;
      font-size: 13px;
      color: #fca5a5;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-weight: 700;
    }
    .pulse-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #ef4444;
      box-shadow: 0 0 10px #ef4444;
      animation: dotBlink 1s infinite alternate;
    }
    @keyframes dotBlink {
      from { opacity: 0.3; }
      to { opacity: 1; }
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
</head>
<body>
  <div class="glow-blob"></div>
  <div class="card">
    <div class="danger-icon-box">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    </div>
    <div class="badge">SYSTEM CRITICAL ALERT</div>
    <h1 class="title">LICENCE PERMANENTLY REVOKED</h1>
    <p class="desc">
      All device streams have been placed on hold by the Seed Administrator.
      <br>
      ${safeSerial ? `Device [${safeSerial}] stream is locked and waiting for administrator to unblock.` : 'This stream is locked and waiting for administrator to unblock.'}
    </p>
    <div class="status-box">
      <div class="pulse-dot"></div>
      <span>STREAM ON HOLD — WAITING FOR SEED ADMIN TO UNBLOCK</span>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script>
    const SUPABASE_KS_URL = 'https://xbolsgcntkfzzpqnulsa.supabase.co';
    const SUPABASE_KS_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhib2xzZ2NudGtmenpwcW51bHNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3OTU2NTAsImV4cCI6MjEwNTM3MTY1MH0.u18WPrgklzJM2kCk4-OxGKoecSuUx4BuOitHrXQNUIk';

    async function checkResumeFromDb() {
      try {
        const r = await fetch(SUPABASE_KS_URL + '/rest/v1/system_kill_switch?id=eq.1&select=is_active', {
          cache: 'no-store',
          headers: { 'apikey': SUPABASE_KS_KEY, 'Authorization': 'Bearer ' + SUPABASE_KS_KEY }
        });
        if (r.ok) {
          const rows = await r.json();
          if (Array.isArray(rows) && rows.length > 0 && rows[0].is_active === false) {
            window.location.reload();
            return;
          }
        }
      } catch (_) {
        try {
          const res = await fetch('/api/kill-switch-status', { cache: 'no-store' });
          if (res.ok) {
            const data = await res.json();
            if (data && data.active === false) window.location.reload();
          }
        } catch (_) {}
      }
    }

    // Direct database check every 1s
    setInterval(checkResumeFromDb, 1000);

    // Supabase Realtime channel for instant reload the millisecond admin toggles off
    try {
      if (window.supabase && typeof window.supabase.createClient === 'function') {
        const sbClient = window.supabase.createClient(SUPABASE_KS_URL, SUPABASE_KS_KEY);
        sbClient.channel('revoked_page_realtime_' + Math.floor(Math.random() * 100000))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'system_kill_switch' }, function(payload) {
            const val = payload.new ? payload.new.is_active : payload.old && payload.old.is_active;
            if (val === false) window.location.reload();
          })
          .subscribe();
      }
    } catch (_) {}
  </script>
</body>
</html>`;
}


function captureOneFrame(serial) {
  return new Promise((resolve) => {
    const p = spawn(ADB_BIN, ['-s', serial, 'exec-out', 'screencap -p'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    p.stdout.on('data', c => chunks.push(c));
    p.on('close', code => {
      if (code !== 0 || !chunks.length) return resolve(null);
      // exec-out via spawn stdio:pipe delivers clean binary — no CRLF stripping needed
      resolve(Buffer.concat(chunks));
    });
    p.on('error', () => resolve(null));
  });
}

// ─── Shared control dispatcher ────────────────────────────────────────────────

const touchGestures = new Map();

function get(data, key) {
  return typeof data.get === 'function' ? data.get(key) : data[key];
}

function handleControl(type, data, serial, engine) {
  if (_isKillSwitchActive) {
    logger.warn(`[Control] BLOCKED ${type} on ${serial} — Global Kill Switch is ACTIVE (Licence Revoked)`);
    return;
  }
  const W = parseFloat(get(data, 'width'))  || engine.screenWidth  || 720;
  const H = parseFloat(get(data, 'height')) || engine.screenHeight || 1600;

  const realW = engine.screenWidth  || 720;
  const realH = engine.screenHeight || 1600;

  const ctrlOk = () => engine.controlSocket && !engine.controlSocket.destroyed;

  const nudgeScreen = () => {
    // Only capture instant screencap if video socket is NOT connected or active,
    // otherwise scrcpy video pipeline is already streaming at 60fps and screencap -p
    // will stall the tablet encoder and ADB pipeline.
    if (engine && (!engine.videoSocket || engine.videoSocket.destroyed) && typeof engine.captureInstantFrame === 'function') {
      setTimeout(() => {
        if (!engine.videoSocket || engine.videoSocket.destroyed) {
          engine.captureInstantFrame();
        }
      }, 70);
    }
  };

  if (type === 'touch') {
    const action = parseInt(get(data, 'action'), 10);
    const x = parseFloat(get(data, 'x'));
    const y = parseFloat(get(data, 'y'));
    const pressure = (typeof data.pressure === 'number') ? data.pressure : (action === 1 ? 0 : 0.6);

    const sx = Math.round((x / W) * realW);
    const sy = Math.round((y / H) * realH);

    // Track touch points for gesture / swipe calculation if falling back to ADB
    if (action === 0) {
      touchGestures.set(serial, { startX: sx, startY: sy, lastX: sx, lastY: sy, time: Date.now() });
    } else if (action === 2) {
      const g = touchGestures.get(serial);
      if (g) { g.lastX = sx; g.lastY = sy; }
    }

    const ok = engine.sendTouchEvent(action, x, y, W, H, pressure);

    // If native scrcpy control is disconnected or unready, fallback to intelligent ADB swipe/tap
    if (action === 1) {
      const g = touchGestures.get(serial);
      touchGestures.delete(serial);
      if (!ok) {
        if (g) {
          const dx = sx - g.startX;
          const dy = sy - g.startY;
          const dist = Math.hypot(dx, dy);
          const dur = Math.max(60, Math.min(500, Date.now() - g.time));
          if (dist > 25) {
            adbInput(serial, `input swipe ${g.startX} ${g.startY} ${sx} ${sy} ${dur}`);
          } else {
            adbInput(serial, `input tap ${g.startX} ${g.startY}`);
          }
        } else {
          adbInput(serial, `input tap ${sx} ${sy}`);
        }
        nudgeScreen();
      }
    }
  } else if (type === 'tap') {
    const x = parseFloat(get(data, 'x')), y = parseFloat(get(data, 'y'));
    let ok = false;
    if (ctrlOk()) {
      ok = engine.sendTouchEvent(0, x, y, W, H, 0.45);
      setTimeout(() => engine.sendTouchEvent(1, x, y, W, H, 0), 65);
    }
    if (!ok) {
      const sx = Math.round((x / W) * realW);
      const sy = Math.round((y / H) * realH);
      adbInput(serial, `input tap ${sx} ${sy}`);
      nudgeScreen();
    }
  } else if (type === 'swipe') {
    const x1 = parseFloat(get(data, 'x1')), y1 = parseFloat(get(data, 'y1'));
    const x2 = parseFloat(get(data, 'x2')), y2 = parseFloat(get(data, 'y2'));
    const dur = Math.min(220, Math.max(70, parseInt(get(data, 'duration'), 10) || 120));

    if (!ctrlOk()) {
      const sx1 = Math.round((x1 / W) * realW), sy1 = Math.round((y1 / H) * realH);
      const sx2 = Math.round((x2 / W) * realW), sy2 = Math.round((y2 / H) * realH);
      adbInput(serial, `input swipe ${sx1} ${sy1} ${sx2} ${sy2} ${dur}`);
      nudgeScreen();
      return;
    }

    // Direct touch injection down immediately
    const downOk = engine.sendTouchEvent(0, x1, y1, W, H, 0.45);
    if (!downOk) {
      const sx1 = Math.round((x1 / W) * realW), sy1 = Math.round((y1 / H) * realH);
      const sx2 = Math.round((x2 / W) * realW), sy2 = Math.round((y2 / H) * realH);
      adbInput(serial, `input swipe ${sx1} ${sy1} ${sx2} ${sy2} ${dur}`);
      nudgeScreen();
      return;
    }

    // High-precision smooth swipe with cubic ease-out (fast initial flick, smooth glide)
    const steps = Math.max(8, Math.floor(dur / 12));
    const dt = dur / steps;
    for (let i = 1; i <= steps; i++) {
      setTimeout(() => {
        const progress = i / steps;
        const ease = 1 - Math.pow(1 - progress, 3);
        const currX = x1 + (x2 - x1) * ease;
        const currY = y1 + (y2 - y1) * ease;
        const action = (i === steps) ? 1 : 2; // UP on final step
        const pVal = (action === 1) ? 0 : 0.6;
        engine.sendTouchEvent(action, currX, currY, W, H, pVal);
      }, Math.round(i * dt));
    }
  } else if (type === 'code' || type === 'key') {
    const code = parseInt(get(data, 'code'), 10);
    let sent = false;
    if (ctrlOk()) {
      sent = engine.sendKeycode(0, code);
      setTimeout(() => engine.sendKeycode(1, code), 50);
    }
    if (!sent) {
      adbInput(serial, `input keyevent ${code}`);
      nudgeScreen();
    }
  } else if (type === 'text') {
    const text = get(data, 'text') || '';
    let sent = false;
    if (ctrlOk()) {
      sent = engine.sendText(text);
    }
    if (!sent) {
      const escaped = text.replace(/(["'`$\\!& |;()<>])/g, '\\$1');
      adbInput(serial, `input text ${escaped}`);
      nudgeScreen();
    }
  } else if (type === 'reboot') {
    exec(`"${ADB_BIN}" -s ${serial} reboot`);
  } else if (type === 'start_audio' || type === 'audio_restart') {
    if (engine && engine.enableAudio && typeof engine._startDedicatedAudioStream === 'function') {
      if (engine._audioProc) {
        try { engine._audioProc.kill(); } catch (_) {}
        engine._audioProc = null;
      }
      engine._startDedicatedAudioStream().catch(() => {});
    }
  } else if (type === 'expand_notifications' || type === 'notifications') {
    exec(`"${ADB_BIN}" -s ${serial} shell cmd statusbar expand`);
    nudgeScreen();
  } else if (type === 'wake' || type === 'refresh' || type === 'request_keyframe') {
    try {
      if (type === 'request_keyframe') {
        if (engine && typeof engine.sendKeyframeToClient === 'function' && data._clientWs) {
          engine.sendKeyframeToClient(data._clientWs);
        } else if (engine && engine._keyframeBuffer) {
          for (const ws of engine.wsClients) {
            if (ws.readyState === 1) {
              try { ws.send(engine._keyframeBuffer, { binary: true }); } catch (_) {}
            }
          }
        }
      }
      if (type === 'wake' || type === 'refresh') {
        if (engine && engine.controlSocket && !engine.controlSocket.destroyed) {
          engine.sendKeycode(0, 224); // KEYCODE_WAKEUP DOWN
          engine.sendKeycode(1, 224); // KEYCODE_WAKEUP UP
        } else {
          adbInput(serial, 'input keyevent 224');
          adbInput(serial, 'wm dismiss-keyguard');
        }
      }
    } catch (_) {}
  }
}


// ─── Server-Side Realtime Device Credential Verification (Redis-backed) ──────

async function verifyDeviceAccess(serial, inputCredential, isCctvView = false) {
  if (!serial) return false;
  // If loading inside CCTV Wall tile (read-only monitoring grid), allow video feed display
  if (isCctvView) return true;

  const inputs = (Array.isArray(inputCredential) ? inputCredential : [inputCredential])
    .filter(Boolean)
    .map(x => String(x).trim())
    .filter(x => x.length > 0);

  // Direct open stream access strictly requires a valid credential (Seed Admin Key or Assigned Worker PIN)
  if (inputs.length === 0) return false;

  // Local dashboard / owner bypass: binding code or active dashboard session token
  const cfg = loadConfig();
  for (const inp of inputs) {
    if (inp === cfg.bindingCode || inp === cfg.sessionToken) return true;
    try {
      const dash = require('../dashboard/server');
      if (dash && dash.SESSION_TOKENS && dash.SESSION_TOKENS.has(inp)) return true;
    } catch (_) {}
  }

  // 1. Redis / in-memory cache check (30s TTL)
  const cacheKey = `cred:${serial}:data`;
  try {
    const cached = await cache.get(cacheKey);
    if (cached) {
      const { validKeys = [], validPins = [], status: devStatus } = cached;
      if (devStatus === 'suspended' || devStatus === 'blocked' || devStatus === 'revoked') return false;
      for (const inp of inputs) {
        if (validPins.includes(inp) || validKeys.includes(inp)) return true;
        for (const k of validKeys) { if (k.toLowerCase() === inp.toLowerCase()) return true; }
        for (const p of validPins) { if (p === inp) return true; }
      }
      // Provided PIN or key has been rotated / unallocated -> deny access
      return false;
    }
  } catch (_) {}

  // 2. Cache miss — query Supabase for active credentials
  const supaUrl = cfg.supabaseUrl;
  const supaKey = cfg.supabaseServiceRoleKey || cfg.supabaseAnonKey;
  if (!supaUrl || !supaKey) return false;

  try {
    const res = await fetch(`${supaUrl.replace(/\/$/, '')}/rest/v1/devices?serial=eq.${encodeURIComponent(serial)}&select=id,status,stream_url`, {
      headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` }
    });
    if (!res.ok) return false;
    const devices = await res.json();
    if (!Array.isArray(devices) || devices.length === 0) return false;

    const dev = devices[0];
    const devStatus = dev.status || 'online';
    if (devStatus === 'suspended' || devStatus === 'blocked' || devStatus === 'revoked') return false;

    const validKeys = [];
    const validPins = [];

    // Parse active Seed Admin master credentials from devices.stream_url
    const currentStreamUrl = dev.stream_url || '';
    const matchKey   = currentStreamUrl.match(/[?&]key=([^&]+)/i);
    const matchPin   = currentStreamUrl.match(/[?&]pin=([^&]+)/i);
    const matchToken = currentStreamUrl.match(/[?&]token=([^&]+)/i);
    if (matchKey)   validKeys.push(decodeURIComponent(matchKey[1]).trim());
    if (matchPin)   validPins.push(decodeURIComponent(matchPin[1]).trim());
    if (matchToken) validKeys.push(decodeURIComponent(matchToken[1]).trim());

    // Parse active worker credentials from device_assignments (assigned user PINs)
    if (dev.id) {
      try {
        const aRes = await fetch(`${supaUrl.replace(/\/$/, '')}/rest/v1/device_assignments?device_id=eq.${encodeURIComponent(dev.id)}&select=access_password`, {
          headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` }
        });
        if (aRes.ok) {
          const assignments = await aRes.json();
          if (Array.isArray(assignments)) {
            for (const a of assignments) {
              if (a.access_password) validPins.push(String(a.access_password).trim());
            }
          }
        }
      } catch (_) {}
    }

    // In-memory runtime rotated keys and pins fallback
    try {
      const lic = require('./license-service');
      if (lic && lic.ROTATED_STREAM_KEYS && lic.ROTATED_STREAM_KEYS.has(serial)) {
        validKeys.push(String(lic.ROTATED_STREAM_KEYS.get(serial)).trim());
      }
      if (lic && lic.ROTATED_STREAM_PINS && lic.ROTATED_STREAM_PINS.has(serial)) {
        validPins.push(String(lic.ROTATED_STREAM_PINS.get(serial)).trim());
      }
    } catch (_) {}

    // Cache verified credentials for fast sub-millisecond lookups
    try {
      await cache.set(cacheKey, { validKeys, validPins, status: devStatus }, cache.TTL.CREDENTIALS);
    } catch (_) {}

    for (const inp of inputs) {
      if (validPins.includes(inp) || validKeys.includes(inp)) return true;
      for (const k of validKeys) { if (k.toLowerCase() === inp.toLowerCase()) return true; }
      for (const p of validPins) { if (p === inp) return true; }
    }

    // Neither Seed Admin master key nor active assignment PIN -> DENIED
    return false;
  } catch (err) {
    logger.warn(`[StreamService] Credential validation error for ${serial}: ${err.message}`);
    return false;
  }
}

// ─── 5 Auto-Sliding Cards Presentation (Vertex Digital) ─────────────────────

function buildVertexCardsHtml(serial, attemptedCredential, isRevokedOrInvalid, customNotice) {
  const prefillSerial = serial ? serial.replace(/"/g, '&quot;') : '';
  const statusMessage = customNotice || (isRevokedOrInvalid 
    ? 'Access credentials for this device were revoked or reset by an administrator. Please provide an active PIN.'
    : 'Direct device authorization required. Individual streams are protected by dynamic cryptographic verification.');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vertex Digital — Enterprise Systems &amp; Management</title>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      background: radial-gradient(circle at 50% 15%, #0f1c3f 0%, #060913 100%);
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
      overflow-x: hidden;
    }

    .container {
      width: 100%;
      max-width: 680px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      align-items: center;
    }

    /* Top Brand Header */
    .brand-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 12px 20px;
      background: rgba(15, 23, 42, 0.7);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(56, 189, 248, 0.2);
      border-radius: 14px;
    }
    .brand-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #38bdf8;
      box-shadow: 0 0 10px #38bdf8;
    }
    .brand-name {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1px;
      color: #f8fafc;
    }
    .brand-contact {
      font-size: 13px;
      font-weight: 600;
      color: #38bdf8;
      text-decoration: none;
      letter-spacing: 0.3px;
    }
    .brand-contact:hover {
      text-decoration: underline;
    }

    /* Notice Banner if access was revoked/reset */
    .notice-banner {
      width: 100%;
      padding: 12px 16px;
      background: rgba(225, 29, 72, 0.12);
      border: 1px solid rgba(225, 29, 72, 0.3);
      border-radius: 12px;
      font-size: 13px;
      color: #fda4af;
      line-height: 1.5;
      text-align: center;
    }

    /* 5-Card Auto-Sliding Carousel */
    .carousel-wrapper {
      position: relative;
      width: 100%;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(56, 189, 248, 0.25);
      border-radius: 22px;
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 40px rgba(37, 99, 235, 0.15);
      overflow: hidden;
      min-height: 320px;
    }

    .carousel-viewport {
      width: 100%;
      overflow: hidden;
      position: relative;
      min-height: 270px;
    }

    .carousel-track {
      display: flex;
      transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      width: 500%;
    }

    .carousel-slide {
      width: 20%;
      padding: 38px 36px 20px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      user-select: none;
    }

    .slide-badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 12px;
      border-radius: 9999px;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.25);
      color: #38bdf8;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.8px;
      text-transform: uppercase;
      margin-bottom: 16px;
      align-self: flex-start;
    }

    .slide-title {
      font-size: 24px;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.4px;
      line-height: 1.3;
      margin-bottom: 14px;
    }

    .slide-text {
      font-size: 14px;
      line-height: 1.7;
      color: #94a3b8;
      margin-bottom: 22px;
    }

    .slide-footer {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      padding-top: 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }

    .info-pill {
      font-size: 12px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 8px;
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(148, 163, 184, 0.15);
      color: #cbd5e1;
    }
    .info-pill.highlight {
      background: rgba(37, 99, 235, 0.2);
      border-color: rgba(56, 189, 248, 0.35);
      color: #38bdf8;
    }

    /* Carousel Controls & Dots */
    .carousel-bottom {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 28px 20px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }

    .carousel-dots {
      display: flex;
      gap: 8px;
    }

    .dot-btn {
      width: 24px;
      height: 6px;
      border-radius: 4px;
      background: rgba(148, 163, 184, 0.25);
      border: none;
      cursor: pointer;
      transition: all 0.3s ease;
      padding: 0;
    }
    .dot-btn.active {
      width: 38px;
      background: #38bdf8;
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.6);
    }

    .nav-arrows {
      display: flex;
      gap: 8px;
    }

    .arrow-btn {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #f8fafc;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    .arrow-btn:hover {
      background: rgba(56, 189, 248, 0.2);
      border-color: #38bdf8;
      color: #38bdf8;
    }

    /* Unlock Form at bottom */
    .auth-card {
      width: 100%;
      padding: 22px 28px;
      background: rgba(15, 23, 42, 0.75);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(148, 163, 184, 0.15);
      border-radius: 18px;
    }

    .auth-title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: #94a3b8;
      margin-bottom: 12px;
    }

    .auth-form {
      display: flex;
      gap: 10px;
    }

    .auth-input {
      flex: 1;
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 10px;
      padding: 12px 16px;
      font-size: 14px;
      color: #ffffff;
      outline: none;
      transition: all 0.2s;
    }
    .auth-input:focus {
      border-color: #38bdf8;
      box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
    }

    .auth-submit {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      border: none;
      border-radius: 10px;
      padding: 12px 22px;
      font-size: 14px;
      font-weight: 700;
      color: #ffffff;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .auth-submit:hover {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      transform: translateY(-1px);
    }

    .call-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      margin-top: 10px;
      padding: 11px 18px;
      border-radius: 10px;
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: #38bdf8;
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
      transition: all 0.2s;
    }
    .call-btn:hover {
      background: rgba(56, 189, 248, 0.15);
      border-color: #38bdf8;
    }

    @media (max-width: 600px) {
      .carousel-slide { padding: 26px 20px 16px; }
      .slide-title { font-size: 20px; }
      .auth-form { flex-direction: column; }
    }
  </style>
</head>
<body>
  <div class="container">

    <!-- Top Header Bar -->
    <div class="brand-bar">
      <div class="brand-left">
        <span class="status-dot"></span>
        <span class="brand-name">VERTEX DIGITAL</span>
      </div>
      <a href="tel:0706499848" class="brand-contact">Call 0706499848</a>
    </div>

    <!-- Notice Banner -->
    <div class="notice-banner">
      ${statusMessage}
    </div>

    <!-- 5 Auto-Sliding Cards Carousel -->
    <div class="carousel-wrapper" id="carouselWrapper">
      <div class="carousel-viewport">
        <div class="carousel-track" id="track">

          <!-- Card 1: System Management & Infrastructure -->
          <div class="carousel-slide">
            <div>
              <span class="slide-badge">SYSTEM MANAGEMENT &amp; INFRASTRUCTURE</span>
              <h2 class="slide-title">Designed &amp; Managed by Vertex Digital</h2>
              <p class="slide-text">This system is designed and managed by Vertex Digital. Call 0706499848 for softwares and systems. Complete platform orchestration, device monitoring, and high-availability operations managed by lead developer Sam.</p>
            </div>
            <div class="slide-footer">
              <span class="info-pill highlight">Developer: Sam</span>
              <span class="info-pill highlight">Call: 0706499848</span>
              <span class="info-pill">Vertex Digital</span>
            </div>
          </div>

          <!-- Card 2: Mobile Device Virtualization -->
          <div class="carousel-slide">
            <div>
              <span class="slide-badge">MOBILE DEVICE VIRTUALIZATION</span>
              <h2 class="slide-title">Low-Latency Hardware Streaming</h2>
              <p class="slide-text">This system is designed and managed by Vertex Digital. Call 0706499848 for softwares and systems. Featuring sub-second H.264 video encoding, dynamic touch relays, and multi-node hardware clustering developed by Sam.</p>
            </div>
            <div class="slide-footer">
              <span class="info-pill highlight">Developer: Sam</span>
              <span class="info-pill highlight">Call: 0706499848</span>
              <span class="info-pill">Hardware Virtualization</span>
            </div>
          </div>

          <!-- Card 3: Dynamic Access Control & Security -->
          <div class="carousel-slide">
            <div>
              <span class="slide-badge">DYNAMIC ACCESS CONTROL &amp; SECURITY</span>
              <h2 class="slide-title">Server-Side Token Verification</h2>
              <p class="slide-text">This system is designed and managed by Vertex Digital. Call 0706499848 for softwares and systems. Protected by server-side verification: when an administrator resets credentials, unauthorized access is instantly terminated.</p>
            </div>
            <div class="slide-footer">
              <span class="info-pill highlight">Developer: Sam</span>
              <span class="info-pill highlight">Call: 0706499848</span>
              <span class="info-pill">Real-Time Revocation</span>
            </div>
          </div>

          <!-- Card 4: Custom Web & Cloud Platforms -->
          <div class="carousel-slide">
            <div>
              <span class="slide-badge">CUSTOM WEB &amp; CLOUD PLATFORMS</span>
              <h2 class="slide-title">Enterprise Software Development</h2>
              <p class="slide-text">This system is designed and managed by Vertex Digital. Call 0706499848 for softwares and systems. Full-stack cloud web applications, automated subscriber portals, and enterprise microservices engineered by Sam.</p>
            </div>
            <div class="slide-footer">
              <span class="info-pill highlight">Developer: Sam</span>
              <span class="info-pill highlight">Call: 0706499848</span>
              <span class="info-pill">Enterprise Software</span>
            </div>
          </div>

          <!-- Card 5: Engineering Consultation & Systems -->
          <div class="carousel-slide">
            <div>
              <span class="slide-badge">ENGINEERING CONSULTATION &amp; SYSTEMS</span>
              <h2 class="slide-title">Direct Technical Consultation</h2>
              <p class="slide-text">This system is designed and managed by Vertex Digital. Call 0706499848 for softwares and systems. Contact developer Sam directly at 0706499848 for custom software architecture, system integration, and commercial platforms.</p>
            </div>
            <div class="slide-footer">
              <span class="info-pill highlight">Developer: Sam</span>
              <span class="info-pill highlight">Call: 0706499848</span>
              <span class="info-pill">Systems Architecture</span>
            </div>
          </div>

        </div>
      </div>

      <!-- Controls and Indicators -->
      <div class="carousel-bottom">
        <div class="carousel-dots" id="dots">
          <button class="dot-btn active" onclick="goToSlide(0)"></button>
          <button class="dot-btn" onclick="goToSlide(1)"></button>
          <button class="dot-btn" onclick="goToSlide(2)"></button>
          <button class="dot-btn" onclick="goToSlide(3)"></button>
          <button class="dot-btn" onclick="goToSlide(4)"></button>
        </div>
        <div class="nav-arrows">
          <button class="arrow-btn" onclick="prevSlide()">&larr;</button>
          <button class="arrow-btn" onclick="nextSlide()">&rarr;</button>
        </div>
      </div>
    </div>

    <!-- Authorized Access Form -->
    <div class="auth-card">
      <div class="auth-title">Authorized Device Stream Access</div>
      <form class="auth-form" onsubmit="handleUnlock(event)">
        <input 
          type="text" 
          id="udidField" 
          class="auth-input" 
          placeholder="Device UDID" 
          value="${prefillSerial}" 
          required 
          autocomplete="off" 
        />
        <input 
          type="password" 
          id="pinField" 
          class="auth-input" 
          placeholder="Current Stream PIN / Key" 
          required 
          autocomplete="off" 
        />
        <button type="submit" class="auth-submit">Connect</button>
      </form>
      <a href="tel:0706499848" class="call-btn">Contact Developer Sam: 0706499848</a>
    </div>

  </div>

  <script>
    let currentSlide = 0;
    const totalSlides = 5;
    const track = document.getElementById('track');
    const dots = document.querySelectorAll('.dot-btn');
    let autoSlideInterval = null;

    function updateCarousel() {
      track.style.transform = 'translateX(-' + (currentSlide * 20) + '%)';
      dots.forEach((dot, index) => {
        if (index === currentSlide) dot.classList.add('active');
        else dot.classList.remove('active');
      });
    }

    function goToSlide(index) {
      currentSlide = (index + totalSlides) % totalSlides;
      updateCarousel();
    }

    function nextSlide() {
      goToSlide(currentSlide + 1);
    }

    function prevSlide() {
      goToSlide(currentSlide - 1);
    }

    function startAutoSlide() {
      stopAutoSlide();
      autoSlideInterval = setInterval(nextSlide, 4500);
    }

    function stopAutoSlide() {
      if (autoSlideInterval) clearInterval(autoSlideInterval);
    }

    const wrapper = document.getElementById('carouselWrapper');
    wrapper.addEventListener('mouseenter', stopAutoSlide);
    wrapper.addEventListener('mouseleave', startAutoSlide);

    startAutoSlide();

    function handleUnlock(e) {
      e.preventDefault();
      const udid = document.getElementById('udidField').value.trim();
      const pin = document.getElementById('pinField').value.trim();
      if (!udid || !pin) return;
      window.location.href = '/?udid=' + encodeURIComponent(udid) + '&pin=' + encodeURIComponent(pin);
    }
  </script>
</body>
</html>`;
}

// ─── Player HTML (WebCodecs H264 decoder + screencap fallback) ───────────────

function buildPlayerHtml(serial, screenW, screenH) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>Stream ${serial}</title>
  <style>
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    html,body{
      height: 100%;
      height: 100dvh;
      width: 100%;
      width: 100vw;
      background: #000;
      color: #f8fafc;
      font-family: system-ui,-apple-system,BlinkMacSystemFont,sans-serif;
      overflow: hidden;
      overscroll-behavior: none;
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      user-select: none;
    }
    body{
      display: flex;
      flex-direction: row;
      align-items: stretch;
      justify-content: center;
      -webkit-tap-highlight-color: transparent;
      min-height: 100%;
      min-height: -webkit-fill-available;
    }

    /* Main Phone/Tablet Viewing Stage */
    .stage{
      flex: 1;
      height: 100%;
      width: 100%;
      min-width: 0;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000;
      position: relative;
      overflow: hidden;
      touch-action: none;
      overscroll-behavior: none;
    }
    .wrap{
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      width: 100%;
      background: #000;
      overflow: hidden;
      touch-action: none;
      overscroll-behavior: none;
    }
    
    /* Enlarged Canvas: fills container cleanly with natural aspect ratio without cropping */
    canvas{
      display: block;
      width: auto;
      height: auto;
      max-width: 100%;
      max-height: 100%;
      cursor: default;
      touch-action: none;
      overscroll-behavior: none;
      -webkit-tap-highlight-color: transparent;
      image-rendering: -webkit-optimize-contrast;
      image-rendering: auto;
      margin: auto;
    }

    /* Sleek Desktop Right Sidebar */
    .sidebar{
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      width: 52px;
      background: rgba(18,22,34,.98);
      border-left: 1px solid rgba(255,255,255,.08);
      padding: 8px 4px;
      height: 100%;
      overflow-y: auto;
      overflow-x: hidden;
      flex-shrink: 0;
      z-index: 20;
      box-shadow: -5px 0 25px rgba(0,0,0,.6);
      touch-action: pan-y;
      -webkit-overflow-scrolling: touch;
    }
    .sidebar-top{
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      width: 100%;
    }
    .sidebar-nav{
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding-top: 8px;
      border-top: 1px solid rgba(255,255,255,0.12);
    }

    .btn{
      width: 40px;
      height: 40px;
      background: rgba(255,255,255,.08);
      border: 1px solid rgba(255,255,255,.12);
      color: #e2e8f0;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      cursor: pointer;
      transition: all .15s ease;
      user-select: none;
      flex-shrink: 0;
      touch-action: manipulation;
    }
    .btn:hover{background:rgba(56,189,248,.25);border-color:rgba(56,189,248,.5);color:#38bdf8}
    .btn:active{transform:scale(.92)}
    
    .btn-nav{
      background: rgba(56,189,248,.12);
      border-color: rgba(56,189,248,.28);
      color: #38bdf8;
    }
    .btn-nav:hover{
      background: rgba(56,189,248,.32);
      color: #fff;
    }
    
    /* Red button specifically for device reboot */
    .btn-red{background:#dc2626 !important;color:#ffffff !important;border:1px solid #ef4444 !important;box-shadow:0 0 10px rgba(220,38,38,.45)}
    .btn-red:hover{background:#ef4444 !important;transform:scale(1.06)}
    .btn-red:active{transform:scale(.92)}
    
    .vol-slider-box{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px 0;width:100%;flex-shrink:0}
    .volume-slider-v{-webkit-appearance:slider-vertical;appearance:slider-vertical;writing-mode:bt-lr;width:6px;height:65px;background:rgba(255,255,255,.15);border-radius:4px;outline:none;cursor:pointer;accent-color:#22c55e}

    /* Mobile Bottom Navigation Bar (Hidden on desktop, prominent & pinned on mobile) */
    .mobile-nav-bar{
      display: none;
      width: 100%;
      height: calc(46px + env(safe-area-inset-bottom, 0px));
      padding-bottom: env(safe-area-inset-bottom, 0px);
      background: rgba(10, 14, 23, 0.96);
      border-top: 1px solid rgba(255, 255, 255, 0.12);
      flex-shrink: 0;
      z-index: 40;
      box-shadow: 0 -3px 20px rgba(0,0,0,0.8);
      backdrop-filter: blur(16px);
      align-items: center;
      justify-content: space-evenly;
      padding-left: 6px;
      padding-right: 6px;
    }

    .mnav-btn{
      flex: 1;
      max-width: 54px;
      height: 38px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      color: #e2e8f0;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      cursor: pointer;
      touch-action: manipulation;
      transition: all .12s ease;
      -webkit-tap-highlight-color: transparent;
      user-select: none;
    }
    .mnav-btn:active{
      background: rgba(56, 189, 248, 0.35);
      color: #38bdf8;
      transform: scale(0.92);
    }
    .mnav-btn-nav{
      background: rgba(56, 189, 248, 0.14);
      border-color: rgba(56, 189, 248, 0.3);
      color: #38bdf8;
    }

    /* Mobile Responsive Adaptation: NO side controls on mobile, device fills screen */
    @media (max-width: 900px), (pointer: coarse), (hover: none) {
      body{
        flex-direction: column !important;
      }
      .sidebar{
        display: none !important;
      }
      .mobile-nav-bar{
        display: flex !important;
      }
      .stage{
        width: 100vw !important;
        height: calc(100dvh - 46px - env(safe-area-inset-bottom, 0px)) !important;
      }
      canvas{
        max-width: 100vw !important;
        max-height: calc(100dvh - 46px - env(safe-area-inset-bottom, 0px)) !important;
      }
    }

    /* Explicit mobile class for guaranteed mobile experience */
    body.is-mobile-device{
      flex-direction: column !important;
    }
    body.is-mobile-device .sidebar{
      display: none !important;
    }
    body.is-mobile-device .mobile-nav-bar{
      display: flex !important;
    }
    body.is-mobile-device .stage{
      width: 100vw !important;
      height: calc(100dvh - 46px - env(safe-area-inset-bottom, 0px)) !important;
    }
    body.is-mobile-device canvas{
      max-width: 100vw !important;
      max-height: calc(100dvh - 46px - env(safe-area-inset-bottom, 0px)) !important;
    }

    /* Modals */
    .modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(6px);z-index:100;align-items:center;justify-content:center}
    .mbox{background:#0f172a;border:1px solid rgba(56,189,248,.4);border-radius:14px;padding:18px;width:92%;max-width:400px;box-shadow:0 20px 30px rgba(0,0,0,.6);max-height:90vh;overflow-y:auto}
    .minput{width:100%;padding:9px 12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);border-radius:9px;color:#fff;font-size:14px;margin-bottom:12px;outline:none}
    .mbtn{width:100%;padding:9px;background:#38bdf8;color:#0f172a;border:none;border-radius:9px;font-weight:700;cursor:pointer}
  </style>
</head>
<body>

<div class="stage">
  <div class="wrap" id="wrap">
    <canvas id="c" width="${screenW}" height="${screenH}" style="aspect-ratio: ${screenW} / ${screenH};"></canvas>
  </div>
</div>

<!-- Sleek Dark Control Sidebar (Desktop Right Side) -->
<div class="sidebar">
  <div class="sidebar-top">
    <button tabindex="-1" onfocus="this.blur()" class="btn" onclick="toggleDebugModal()" title="Options & Diagnostics"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>
    
    <!-- Red Button inside controls for Rebooting -->
    <button tabindex="-1" onfocus="this.blur()" class="btn btn-red" onclick="reboot()" title="Reboot Device"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>
    
    <button tabindex="-1" onfocus="this.blur()" class="btn" onclick="rotateScreen()" title="Rotate Screen"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg></button>
    <button tabindex="-1" onfocus="this.blur()" class="btn" onclick="key(26)" title="Power / Lock"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg></button>
    <button tabindex="-1" onfocus="this.blur()" class="btn" onclick="key(24)" title="Volume Up"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="19" y1="12" x2="19" y2="12"/><line x1="15" y1="9" x2="15" y2="15"/><line x1="12" y1="12" x2="18" y2="12"/></svg></button>
    <button tabindex="-1" onfocus="this.blur()" class="btn" onclick="key(25)" title="Volume Down"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="15" y1="12" x2="20" y2="12"/></svg></button>
    <button tabindex="-1" onfocus="this.blur()" class="btn" onclick="screenshot()" title="Take Screenshot"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button>
    <button tabindex="-1" onfocus="this.blur()" class="btn" onclick="openText()" title="Send Text"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="8" x2="6.01" y2="8"/><line x1="10" y1="8" x2="10.01" y2="8"/><line x1="14" y1="8" x2="14.01" y2="8"/><line x1="18" y1="8" x2="18.01" y2="8"/><line x1="7" y1="16" x2="17" y2="16"/></svg></button>
    <button tabindex="-1" onfocus="this.blur()" class="btn" onclick="openUpload()" title="Upload File to Phone"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></button>
    <button tabindex="-1" onfocus="this.blur()" class="btn" id="muteBtn" onclick="toggleMute()" title="Mute/Unmute Audio"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></button>
    
    <!-- Vertical Green Volume Slider -->
    <div class="vol-slider-box" title="Volume Slider">
      <input tabindex="-1" onfocus="this.blur()" type="range" min="0" max="100" value="100" class="volume-slider-v" id="volSlider" oninput="setVolume(this.value)"/>
    </div>
  </div>

  <!-- Dedicated Phone Navigation Bar Group (Back, Home, Recents) -->
  <div class="sidebar-nav">
    <button tabindex="-1" onfocus="this.blur()" class="btn btn-nav" onclick="key(4)" title="Back"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="17 4 7 12 17 20 17 4"/></svg></button>
    <button tabindex="-1" onfocus="this.blur()" class="btn btn-nav" onclick="key(3)" title="Home"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="8"/></svg></button>
    <button tabindex="-1" onfocus="this.blur()" class="btn btn-nav" onclick="key(187)" title="Recents / App Switcher"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="4" y="4" width="16" height="16" rx="2"/></svg></button>
  </div>
</div>

<!-- Mobile Bottom Navigation Bar (Always visible & docked on mobile screens) -->
<div class="mobile-nav-bar">
  <button class="mnav-btn mnav-btn-nav" onclick="key(4)" title="Back (◁)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="17 4 7 12 17 20 17 4"/></svg></button>
  <button class="mnav-btn mnav-btn-nav" onclick="key(3)" title="Home (○)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="8"/></svg></button>
  <button class="mnav-btn mnav-btn-nav" onclick="key(187)" title="Recents (□)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="4" y="4" width="16" height="16" rx="2"/></svg></button>
  <button class="mnav-btn" onclick="key(26)" title="Power / Lock"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg></button>
  <button class="mnav-btn" onclick="rotateScreen()" title="Rotate Screen"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg></button>
  <button class="mnav-btn" onclick="toggleDebugModal()" title="Options & Tools"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="12" cy="19" r="2"/></svg></button>
</div>

<div class="modal" id="textModal">
  <div class="mbox">
    <div style="font-weight:700;margin-bottom:10px">Send Text</div>
    <input class="minput" id="textVal" placeholder="Type here..." onkeydown="if(event.key==='Enter')doText()"/>
    <button class="mbtn" onclick="doText()">Send</button>
  </div>
</div>
<div class="modal" id="uploadModal">
  <div class="mbox">
    <div style="font-weight:700;margin-bottom:10px">Upload to Phone</div>
    <input class="minput" type="file" id="filePick" accept="image/*,video/*"/>
    <button class="mbtn" onclick="doUpload()">Upload</button>
  </div>
</div>

<div class="modal" id="debugModal">
  <div class="mbox">
    <div style="font-weight:700;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:16px">📱 Device Controls &amp; Options</span>
      <button onclick="document.getElementById('debugModal').style.display='none'" style="background:none;border:none;color:#94a3b8;font-size:22px;cursor:pointer;line-height:1">&times;</button>
    </div>

    <!-- Quick Tools Grid (Essential on mobile) -->
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:14px">
      <button class="mbtn" onclick="screenshot()" style="background:rgba(255,255,255,0.08);color:#e2e8f0;padding:8px 10px;font-size:12px;font-weight:600">📸 Screenshot</button>
      <button class="mbtn" onclick="openText()" style="background:rgba(255,255,255,0.08);color:#e2e8f0;padding:8px 10px;font-size:12px;font-weight:600">⌨️ Send Text</button>
      <button class="mbtn" onclick="openUpload()" style="background:rgba(255,255,255,0.08);color:#e2e8f0;padding:8px 10px;font-size:12px;font-weight:600">📁 Upload File</button>
      <button class="mbtn" onclick="toggleMute()" id="modalMuteBtn" style="background:rgba(255,255,255,0.08);color:#e2e8f0;padding:8px 10px;font-size:12px;font-weight:600">🔊 Mute/Unmute</button>
      <button class="mbtn" onclick="key(24)" style="background:rgba(255,255,255,0.08);color:#e2e8f0;padding:8px 10px;font-size:12px;font-weight:600">🔊 Vol Up</button>
      <button class="mbtn" onclick="key(25)" style="background:rgba(255,255,255,0.08);color:#e2e8f0;padding:8px 10px;font-size:12px;font-weight:600">🔉 Vol Down</button>
    </div>

    <div style="margin-bottom:14px">
      <button class="mbtn" onclick="reboot()" style="background:#dc2626;color:#ffffff;font-size:13px;padding:9px">🔄 Reboot Device</button>
    </div>

    <div style="border-top:1px solid rgba(255,255,255,0.1);padding-top:12px;display:flex;flex-direction:column;gap:8px;font-size:12px;color:#94a3b8">
      <div>Device Serial: <strong style="color:#fff">${serial}</strong></div>
      <div>Stream Resolution: <strong style="color:#38bdf8" id="dbgRes">--</strong></div>
      <div>Stream Status: <strong style="color:#34d399" id="modeText">CONNECTING</strong> (<span id="fps">--fps</span>)</div>
      <div>Decoder Engine: <strong style="color:#34d399" id="dbgCodec">WebCodecs Hardware</strong></div>
      <div>WebSocket State: <strong style="color:#c084fc" id="dbgWs">--</strong></div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="mbtn" onclick="reconnectStream()" style="flex:1;padding:8px;font-size:12px">🔄 Reconnect</button>
        <button class="mbtn" onclick="popOutWindow()" style="flex:1;background:rgba(255,255,255,0.12);color:#fff;padding:8px;font-size:12px">🗗 Pop Out</button>
      </div>
    </div>
  </div>
</div>

<script>
  const canvas = document.getElementById('c');
  const ctx    = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const wrap   = document.getElementById('wrap');
  const badge  = document.getElementById('badge');
  const modeText = document.getElementById('modeText');
  const fpsEl  = document.getElementById('fps');

  let nativeW = ${screenW}, nativeH = ${screenH};

  // ── Mobile Device Detection (No side controls, full-screen canvas on mobile) ──
  function updateMobileMode() {
    const isMob = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent) || 
      (window.matchMedia && window.matchMedia('(max-width: 900px), (pointer: coarse), (hover: none)').matches);
    if (isMob) {
      document.body.classList.add('is-mobile-device');
    } else {
      document.body.classList.remove('is-mobile-device');
    }
  }
  updateMobileMode();
  window.addEventListener('resize', updateMobileMode);
  window.addEventListener('orientationchange', updateMobileMode);

  // ── FPS counter ─────────────────────────────────────────────────────────
  let fc = 0, fpsT = performance.now();
  function countFrame() {
    fc++;
    const now = performance.now();
    if (now - fpsT >= 1000) { fpsEl.textContent = fc + 'fps'; fc = 0; fpsT = now; }
  }

  // ── rAF draw queue ───────────────────────────────────────────────────────
  let pendingFrame = null, rafId = null;
  function queueDraw(bitmapOrImage) {
    if (pendingFrame && pendingFrame.close) pendingFrame.close();
    pendingFrame = bitmapOrImage;
    if (!rafId) rafId = requestAnimationFrame(doDraw);
  }
  function doDraw() {
    rafId = null;
    if (!pendingFrame) return;
    const f = pendingFrame; pendingFrame = null;
    const w = f.displayWidth  || f.codedWidth  || f.width;
    const h = f.displayHeight || f.codedHeight || f.height;
    if (w && h && (Math.abs(canvas.width - w) > 8 || Math.abs(canvas.height - h) > 8)) {
      canvas.width = w; canvas.height = h; nativeW = w; nativeH = h;
      canvas.style.aspectRatio = w + ' / ' + h;
      console.log('[Canvas] Resized to ' + w + 'x' + h);
    }
    ctx.drawImage(f, 0, 0, canvas.width, canvas.height);
    if (f.close) f.close();
    countFrame();
  }

  // ── Audio Engine — WebCodecs (Opus / AAC) + Safe Raw PCM Fallback with Jitter Buffer ────
  let audioCtx = null;
  let gainNode = null;
  let opusDecoder = null;
  let opusDecoderReady = false;
  let opusConfig = null;
  let aacDecoder = null;
  let aacDecoderReady = false;
  let aacConfig = null;
  let audioNextPlayTime = 0;
  const urlParams = new URLSearchParams(window.location.search);
  let isMuted = urlParams.get('muted') === '1' || urlParams.get('muted') === 'true';
  if (urlParams.get('muted') === '0' || urlParams.get('muted') === 'false') {
    isMuted = false;
  }
  let currentVolume = 100;

  function initAudio() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume().then(hideAudioResumePrompt).catch(function() {});
      return;
    }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      audioCtx = new AudioCtx({ sampleRate: 48000, latencyHint: 'interactive' });
      gainNode = audioCtx.createGain();
      gainNode.gain.value = isMuted ? 0 : (currentVolume / 100);
      gainNode.connect(audioCtx.destination);
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().then(hideAudioResumePrompt).catch(function() {});
      }
    } catch (_) {}
  }

  // Jitter buffer lead time for smooth, gap-free, stutter-free continuous streaming
  const JITTER_BUFFER = 0.06; // 60ms lead time target
  const MAX_DRIFT     = 0.30; // 300ms max allowed queue drift before soft resync

  function scheduleAudioBuffer(audioBuf) {
    if (!audioCtx || !gainNode || isMuted) return;
    try {
      const src = audioCtx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(gainNode);

      const now = audioCtx.currentTime;
      if (audioNextPlayTime < now + 0.01) {
        // Queue underrun or starting fresh: prime lead time
        audioNextPlayTime = now + JITTER_BUFFER;
      } else if (audioNextPlayTime > now + MAX_DRIFT) {
        // Excessive latency drift: gently catch up to lead time
        audioNextPlayTime = now + JITTER_BUFFER;
      }

      src.start(audioNextPlayTime);
      audioNextPlayTime += audioBuf.duration;
      hideAudioResumePrompt();
    } catch (e) {
      console.warn('[Audio] playback error:', e);
    }
  }

  function audioDataToBuffer(audioData) {
    try {
      const nCh     = audioData.numberOfChannels;
      const nFrames = audioData.numberOfFrames;
      const sr      = audioData.sampleRate;
      const webAudioBuf = audioCtx.createBuffer(nCh, nFrames, sr);

      let isPlanar = false;
      if (nCh > 1) {
        try {
          audioData.allocationSize({ planeIndex: 1, format: 'f32-planar' });
          isPlanar = true;
        } catch (_) {
          isPlanar = false;
        }
      }

      if (isPlanar) {
        for (let ch = 0; ch < nCh; ch++) {
          const byteLen = audioData.allocationSize({ planeIndex: ch, format: 'f32-planar' });
          const plane = new Float32Array(byteLen / 4);
          audioData.copyTo(plane, { planeIndex: ch, format: 'f32-planar' });
          webAudioBuf.copyToChannel(plane, ch);
        }
      } else {
        const byteLen = audioData.allocationSize({ planeIndex: 0, format: 'f32' });
        const interleaved = new Float32Array(byteLen / 4);
        audioData.copyTo(interleaved, { planeIndex: 0, format: 'f32' });
        for (let ch = 0; ch < nCh; ch++) {
          const chData = webAudioBuf.getChannelData(ch);
          for (let i = 0; i < nFrames; i++) chData[i] = interleaved[i * nCh + ch];
        }
      }
      return webAudioBuf;
    } finally {
      try { audioData.close(); } catch (_) {}
    }
  }

  function initOpusDecoder(description) {
    if (typeof AudioDecoder === 'undefined') return false;
    try {
      if (opusDecoder && opusDecoder.state !== 'closed') {
        try { opusDecoder.close(); } catch (_) {}
      }
      opusDecoder = new AudioDecoder({
        output: function(audioData) {
          if (!audioCtx || !gainNode || isMuted) {
            try { audioData.close(); } catch (_) {}
            return;
          }
          const buf = audioDataToBuffer(audioData);
          if (buf) scheduleAudioBuffer(buf);
        },
        error: function(err) {
          console.warn('[Audio] Opus decoder error:', err);
          opusDecoderReady = false;
        }
      });
      const cfg = { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 };
      if (description && description.byteLength > 0) cfg.description = description;
      opusDecoder.configure(cfg);
      opusDecoderReady = true;
      return true;
    } catch (err) {
      console.warn('[Audio] Opus init failed:', err);
      opusDecoderReady = false;
      return false;
    }
  }

  function playOpusPacket(bytes, isConfig) {
    if (isMuted) return;
    if (!audioCtx) initAudio();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(function() {});
      showAudioResumePrompt();
    }

    // Check if packet is Opus identification header (OpusHead)
    const isOpusHead = (bytes.length >= 8 && bytes[0] === 0x4F && bytes[1] === 0x70 && bytes[2] === 0x75 && bytes[3] === 0x73 && bytes[4] === 0x48);
    if (isConfig || isOpusHead) {
      opusConfig = bytes;
      initOpusDecoder(opusConfig);
      return;
    }

    if (!opusDecoderReady || !opusDecoder || opusDecoder.state === 'closed') {
      if (!initOpusDecoder(opusConfig)) return;
    }

    try {
      opusDecoder.decode(new EncodedAudioChunk({
        type: 'key',
        timestamp: performance.now() * 1000,
        data: bytes
      }));
    } catch (err) {
      console.warn('[Audio] Opus decode error:', err);
      opusDecoderReady = false;
    }
  }

  function initAacDecoder(description) {
    if (typeof AudioDecoder === 'undefined') return false;
    try {
      if (aacDecoder && aacDecoder.state !== 'closed') {
        try { aacDecoder.close(); } catch (_) {}
      }
      aacDecoder = new AudioDecoder({
        output: function(audioData) {
          if (!audioCtx || !gainNode || isMuted) {
            try { audioData.close(); } catch (_) {}
            return;
          }
          const buf = audioDataToBuffer(audioData);
          if (buf) scheduleAudioBuffer(buf);
        },
        error: function(err) {
          console.warn('[Audio] AAC decoder error:', err);
          aacDecoderReady = false;
        }
      });
      const cfg = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 };
      if (description && description.byteLength > 0) cfg.description = description;
      aacDecoder.configure(cfg);
      aacDecoderReady = true;
      return true;
    } catch (err) {
      console.warn('[Audio] AAC init failed:', err);
      aacDecoderReady = false;
      return false;
    }
  }

  function playAacPacket(bytes, isConfig) {
    if (isMuted) return;
    if (!audioCtx) initAudio();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(function() {});
      showAudioResumePrompt();
    }

    if (isConfig) {
      aacConfig = bytes;
      initAacDecoder(aacConfig);
      return;
    }

    if (!aacDecoderReady || !aacDecoder || aacDecoder.state === 'closed') {
      if (!initAacDecoder(aacConfig)) return;
    }

    try {
      aacDecoder.decode(new EncodedAudioChunk({
        type: 'key',
        timestamp: performance.now() * 1000,
        data: bytes
      }));
    } catch (err) {
      console.warn('[Audio] AAC decode error:', err);
      aacDecoderReady = false;
    }
  }

  function playRawPcm(bytes) {
    if (isMuted) return;
    if (!audioCtx) initAudio();
    if (!audioCtx || !gainNode) return;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(function() {});
      showAudioResumePrompt();
    }
    try {
      // Raw 16-bit signed LE stereo 48kHz PCM
      // 2 channels * 2 bytes = 4 bytes per sample
      const sampleCount = Math.floor(bytes.byteLength / 4);
      if (sampleCount <= 0) return;

      const webAudioBuf = audioCtx.createBuffer(2, sampleCount, 48000);
      const L = webAudioBuf.getChannelData(0);
      const R = webAudioBuf.getChannelData(1);

      // Safe DataView access eliminates any TypedArray alignment issues
      const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 4);
      for (let i = 0; i < sampleCount; i++) {
        L[i] = view.getInt16(i * 4, true) / 32768.0;
        R[i] = view.getInt16(i * 4 + 2, true) / 32768.0;
      }

      scheduleAudioBuffer(webAudioBuf);
    } catch (err) {
      console.warn('[Audio] Raw PCM playback error:', err);
    }
  }

  function showAudioResumePrompt() {
    if (isMuted) return;
    let el = document.getElementById('audioResumeBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'audioResumeBanner';
      el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,0.92);border:1px solid rgba(59,130,246,0.6);backdrop-filter:blur(8px);color:#93c5fd;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px;cursor:pointer;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,0.5);transition:opacity 0.2s ease;';
      el.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg><span>Click to enable sound</span>';
      el.onclick = function() {
        initAudio();
        if (audioCtx) audioCtx.resume().then(hideAudioResumePrompt).catch(function(){});
      };
      document.body.appendChild(el);
    }
  }

  function hideAudioResumePrompt() {
    const el = document.getElementById('audioResumeBanner');
    if (el) el.remove();
  }

  function syncMuteUI() {
    const btn = document.getElementById('muteBtn');
    if (btn) {
      btn.innerHTML = (isMuted || currentVolume === 0)
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="1" y1="1" x2="23" y2="23"/><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
      btn.title = isMuted ? 'Unmute audio' : 'Mute audio';
      btn.style.color = (isMuted || currentVolume === 0) ? '#f87171' : '';
      btn.style.borderColor = (isMuted || currentVolume === 0) ? 'rgba(248,113,113,.5)' : '';
    }
    const iconM = document.getElementById('muteBtnMIcon');
    const btnM  = document.getElementById('muteBtnM');
    if (iconM) iconM.innerHTML = (isMuted || currentVolume === 0)
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="1" y1="1" x2="23" y2="23"/><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
    if (btnM) {
      btnM.style.color = (isMuted || currentVolume === 0) ? '#f87171' : '';
      btnM.style.borderColor = (isMuted || currentVolume === 0) ? 'rgba(248,113,113,.5)' : '';
    }
    const modalBtn = document.getElementById('modalMuteBtn');
    if (modalBtn) {
      modalBtn.textContent = (isMuted || currentVolume === 0) ? '🔇 Unmute Audio' : '🔊 Mute Audio';
    }
    const slider = document.getElementById('volSlider');
    if (slider) {
      slider.value = isMuted ? 0 : currentVolume;
    }
  }

  // ── Mute toggle ──────────────────────────────────────────────────────────
  function toggleMute() {
    isMuted = !isMuted;
    initAudio();
    if (gainNode) {
      gainNode.gain.value = isMuted ? 0 : (currentVolume / 100);
    }
    if (!isMuted && audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().then(hideAudioResumePrompt).catch(function(){});
    }
    if (isMuted) {
      if (opusDecoder && opusDecoder.state !== 'closed') {
        try { opusDecoder.flush().catch(function(){}); } catch (_) {}
      }
      if (aacDecoder && aacDecoder.state !== 'closed') {
        try { aacDecoder.flush().catch(function(){}); } catch (_) {}
      }
    }
    syncMuteUI();
  }

  // Sync mute UI on initial load
  setTimeout(syncMuteUI, 50);

  // Resume AudioContext on first user gesture
  ['click', 'mousedown', 'pointerdown', 'touchstart', 'keydown'].forEach(function(evt) {
    window.addEventListener(evt, function() {
      initAudio();
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().then(hideAudioResumePrompt).catch(function(){});
      }
    }, { passive: true });
  });

  // ── WebCodecs H264 Decoder (Auto-adapts to phones, tablets, and any hardware profile) ──
  let decoder = null;
  let decoderReady = false;
  let hasKeyframe = false;
  let activeCodec = 'avc1.42E02A';

  function parseSpsCodec(u8) {
    const limit = Math.min(u8.length - 4, 512);
    for (let i = 0; i < limit; i++) {
      if (u8[i] === 0 && u8[i+1] === 0) {
        let start = -1;
        if (u8[i+2] === 1 && (u8[i+3] & 0x1f) === 7) start = i + 4;
        else if (u8[i+2] === 0 && u8[i+3] === 1 && (u8[i+4] & 0x1f) === 7) start = i + 5;
        if (start >= 0 && start + 3 <= u8.length) {
          const profile = u8[start].toString(16).padStart(2, '0');
          const compat  = u8[start+1].toString(16).padStart(2, '0');
          const level   = u8[start+2].toString(16).padStart(2, '0');
          return 'avc1.' + profile + compat + level;
        }
      }
    }
    return null;
  }

  function resetDecoder() {
    hasKeyframe = false;
    if (decoder) {
      try { decoder.close(); } catch (_) {}
      decoder = null;
    }
    decoderReady = false;
  }

  function initDecoder(codecOverride) {
    resetDecoder();
    if (typeof VideoDecoder === 'undefined') {
      console.warn('[Stream] WebCodecs VideoDecoder not available in this browser');
      return false;
    }
    try {
      const targetCodec = codecOverride || activeCodec || 'avc1.42E02A';
      decoder = new VideoDecoder({
        output: function(frame) {
          lastFrameReceivedTime = Date.now();
          const w = frame.displayWidth  || frame.codedWidth  || frame.width;
          const h = frame.displayHeight || frame.codedHeight || frame.height;
          if (w && h && (Math.abs(canvas.width - w) > 8 || Math.abs(canvas.height - h) > 8)) {
            canvas.width = w; canvas.height = h; nativeW = w; nativeH = h;
            canvas.style.aspectRatio = w + ' / ' + h;
            const dbgRes = document.getElementById('dbgRes');
            if (dbgRes) dbgRes.textContent = w + ' x ' + h;
          }
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
          frame.close();
          countFrame();
        },
        error: function(err) {
          console.warn('[Stream] VideoDecoder error:', err);
          resetDecoder();
          initDecoder(activeCodec);
          send({ type: 'request_keyframe' });
          send({ type: 'wake' });
        }
      });
      decoder.configure({
        codec: targetCodec,
        optimizeForLatency: true,
        hardwareAcceleration: 'prefer-hardware'
      });
      decoderReady = true;
      activeCodec = targetCodec;
      const dbgCodec = document.getElementById('dbgCodec');
      if (dbgCodec) dbgCodec.textContent = targetCodec;
      return true;
    } catch (err) {
      console.error('[Stream] Failed to init VideoDecoder with codec ' + (codecOverride || activeCodec) + ':', err);
      return false;
    }
  }

  function isH264Keyframe(u8) {
    const limit = Math.min(u8.length - 4, 1024);
    for (let i = 0; i < limit; i++) {
      if (u8[i] === 0 && u8[i+1] === 0) {
        let ntype = -1;
        if (u8[i+2] === 1 && i + 3 < u8.length) {
          ntype = u8[i+3] & 0x1f;
        } else if (u8[i+2] === 0 && u8[i+3] === 1 && i + 4 < u8.length) {
          ntype = u8[i+4] & 0x1f;
        }
        // WebCodecs requires NAL 5 (IDR) to initialize decoded state before deltas
        if (ntype === 5) return true;
      }
    }
    return false;
  }

  // ── Tab Visibility & Focus Resilience ─────────────────────────────────────
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      console.log('[Stream] Tab became active — refreshing decoder & requesting keyframe');
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(function(){});
      if (!wsOk || !ws || ws.readyState !== 1) {
        connectWS();
      } else {
        send({ type: 'request_keyframe' });
        send({ type: 'wake' });
      }
    }
  });

  window.addEventListener('focus', function() {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(function(){});
    if (wsOk && ws && ws.readyState === 1) {
      send({ type: 'request_keyframe' });
    }
  });

  // ── WebSocket connection ─────────────────────────────────────────────────
  let ws = null, wsOk = false;
  let wsFailCount = 0;
  let wsRetryTimer = null;
  let lastFrameReceivedTime = 0;
  let lastKeyframeReqTime = 0;

  // Fallback watchdog: only fires if WS is connected but no frames arrive for >15s.
  setInterval(function() {
    if (!wsOk) return;
    if (lastFrameReceivedTime === 0) return;
    if (Date.now() - lastFrameReceivedTime > 15000 && !fbRunning) {
      console.warn('[Watchdog] No frames for 15s — requesting keyframe & wake');
      send({ type: 'request_keyframe' });
      send({ type: 'wake' });
    }
  }, 1000);

  // Separate first-frame watchdog — if WS is open but no frame ever arrives in 12s, fallback
  let firstFrameTimer = null;
  function startFirstFrameWatchdog() {
    if (firstFrameTimer) clearTimeout(firstFrameTimer);
    firstFrameTimer = setTimeout(function() {
      if (wsOk && lastFrameReceivedTime === 0 && !fbRunning) {
        console.warn('[Watchdog] No first frame within 12s — requesting keyframe');
        send({ type: 'request_keyframe' });
        send({ type: 'wake' });
      }
    }, 12000);
  }

  function connectWS() {
    if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = null; }
    if (ws) {
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
      } catch (_) {}
      ws = null;
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/ws' + location.search);
    ws.binaryType = 'arraybuffer';

    ws.onopen = function() {
      wsOk = true;
      wsFailCount = 0;
      lastFrameReceivedTime = 0;
      modeText.textContent = 'LIVE 60FPS';
      resetDecoder();
      initDecoder();
      audioNextPlayTime = 0;
      fbRunning = false;
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(function(){});
      flushQueue();
      // Instantly request keyframe & wake Android encoder
      send({ type: 'request_keyframe' });
      send({ type: 'wake' });
    };

    ws.onmessage = function(e) {
      // JSON control messages (stream_reset, resolution_change, heartbeat, etc.)
      if (typeof e.data === 'string' || e.data instanceof ArrayBuffer && e.data.byteLength > 0 && new Uint8Array(e.data)[0] === 0x7B) {
        try {
          const txt = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
          const msg = JSON.parse(txt);
          if (msg.type === 'heartbeat') {
            send({ type: 'pong' });
            return;
          }
          if (msg.type === 'resolution_change') {
            const isFlip = nativeW && nativeH && ((nativeW > nativeH) !== (msg.width > msg.height));
            const isDiff = Math.abs((canvas.width || nativeW) - msg.width) > 16 || Math.abs((canvas.height || nativeH) - msg.height) > 16;
            if (isFlip || isDiff) {
              console.log('[Stream] Dynamic orientation/resolution update: ' + msg.width + 'x' + msg.height);
              nativeW = msg.width;
              nativeH = msg.height;
              canvas.width = msg.width;
              canvas.height = msg.height;
              canvas.style.aspectRatio = msg.width + ' / ' + msg.height;
              // Cleanly reconfigure decoder for the new dimensions without forcing codec down to baseline
              if (decoder && decoder.state !== 'closed') {
                try {
                  decoder.configure({
                    codec: activeCodec || 'avc1.42E02A',
                    optimizeForLatency: true,
                    hardwareAcceleration: 'prefer-hardware'
                  });
                } catch (_) {}
              }
              const dbgRes = document.getElementById('dbgRes');
              if (dbgRes) dbgRes.textContent = msg.width + ' x ' + msg.height;
            }
            return;
          } else if (msg.type === 'stream_reset') {
            console.log('[Stream] Server stream reset — reinitialising decoder');
            resetDecoder();
            initDecoder();
            fbRunning = false;
            lastFrameReceivedTime = 0;
            send({ type: 'request_keyframe' });
            return;
          } else if (msg.type === 'stream_revoked') {
            console.warn('[Stream] Access revoked by administrator:', msg.reason);
            try { localStorage.removeItem('device_pin_auth_${serial}'); } catch (_) {}
            window.location.reload();
            return;
          }
          return;
        } catch (_) {}
      }

      if (!(e.data instanceof ArrayBuffer)) return;
      lastFrameReceivedTime = Date.now();
      if (fbRunning) { fbRunning = false; modeText.textContent = 'LIVE 60FPS'; }

      const rawU8 = new Uint8Array(e.data);
      if (rawU8.length < 4) return;

      // Handle tagged Audio binary frames — [0x41][codec][flags][payload] or [0x41][codec][payload]
      if (rawU8[0] === 0x41) {
        if (rawU8.length < 3) return;
        const codec = rawU8[1]; // 0x4F='O' opus, 0x43='C' aac, 0x52='R' raw
        let isConfig = false;
        let payload;
        if (rawU8.length >= 4 && (rawU8[2] === 0x00 || rawU8[2] === 0x01)) {
          isConfig = (rawU8[2] === 0x01);
          payload = rawU8.subarray(3);
        } else {
          payload = rawU8.subarray(2);
        }

        if (codec === 0x4F) {        // Opus
          playOpusPacket(payload, isConfig);
        } else if (codec === 0x43) { // AAC
          playAacPacket(payload, isConfig);
        } else {                     // Raw PCM
          playRawPcm(payload);
        }
        return;
      }

      const u8 = (rawU8[0] === 0x56) ? rawU8.subarray(1) : rawU8;

      // 1. PNG Image Auto-detection (0x89 0x50 0x4E 0x47)
      if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) {
        createImageBitmap(new Blob([u8], { type: 'image/png' }))
          .then(function(bmp) { queueDraw(bmp); })
          .catch(function(err) { console.warn('[Stream] PNG decode error:', err); });
        return;
      }

      // 2. JPEG Image Auto-detection (0xFF 0xD8)
      if (u8[0] === 0xFF && u8[1] === 0xD8) {
        createImageBitmap(new Blob([u8], { type: 'image/jpeg' }))
          .then(function(bmp) { queueDraw(bmp); })
          .catch(function(err) { console.warn('[Stream] JPEG decode error:', err); });
        return;
      }

      // 3. Raw H264 NAL stream via WebCodecs
      // Auto-adapt decoder codec if incoming SPS specifies a different H264 profile/level
      const spsCodec = parseSpsCodec(u8);
      if (spsCodec && spsCodec !== activeCodec) {
        console.log('[Stream] Adapting decoder to hardware stream profile: ' + spsCodec);
        activeCodec = spsCodec;
        if (decoder && decoder.state !== 'closed') {
          try {
            decoder.configure({
              codec: spsCodec,
              optimizeForLatency: true,
              hardwareAcceleration: 'prefer-hardware'
            });
            const dbgCodec = document.getElementById('dbgCodec');
            if (dbgCodec) dbgCodec.textContent = spsCodec;
          } catch (_) {
            initDecoder(spsCodec);
          }
        }
      }

      if (!decoderReady || !decoder || decoder.state === 'closed') {
        if (!initDecoder(activeCodec)) {
          startFallback();
          return;
        }
      }

      const key = isH264Keyframe(u8);
      if (key) hasKeyframe = true;
      if (!hasKeyframe) {
        // Delta chunk received without an active keyframe — request keyframe immediately
        if (Date.now() - lastKeyframeReqTime > 1000) {
          lastKeyframeReqTime = Date.now();
          send({ type: 'request_keyframe' });
        }
        return;
      }

      try {
        const chunk = new EncodedVideoChunk({
          type: key ? 'key' : 'delta',
          timestamp: performance.now() * 1000,
          data: u8
        });
        decoder.decode(chunk);
      } catch (err) {
        hasKeyframe = false;
        console.warn('[Stream] H264 chunk decode error:', err);
        send({ type: 'request_keyframe' });
        send({ type: 'wake' });
      }
    };

    // Auto-nudge Android screen compositor & request keyframe ONLY if keyframe has not been acquired yet
    setInterval(function() {
      if (!wsOk) return;
      const now = Date.now();
      if (!hasKeyframe && (now - lastKeyframeReqTime > 2000)) {
        lastKeyframeReqTime = now;
        send({ type: 'request_keyframe' });
        send({ type: 'wake' });
      }
      if (lastFrameReceivedTime > 0 && (now - lastFrameReceivedTime > 30000)) {
        send({ type: 'wake' });
      }
    }, 2000);

    ws.onerror = function() {};

    ws.onclose = function() {
      wsOk = false;
      wsFailCount++;
      if (wsFailCount >= 15 && !fbRunning) startFallback();
      const delay = wsFailCount < 5 ? 500 : 1000;
      wsRetryTimer = setTimeout(connectWS, delay);
    };
  }

  // ── HTTP screencap fallback ───────────────────────────────────────────────
  // DISABLED — strict scrcpy H264 only, no fallback
  let fbRunning = false;
  function startFallback() {
    // Disabled
  }

  // ── Control: WS-only, never fetch ───────────────────────────────────────
  const ctrlQueue = [];
  function flushQueue() {
    while (ctrlQueue.length && ws && ws.readyState === 1)
      ws.send(JSON.stringify(ctrlQueue.shift()));
  }
  function send(data) {
    if (ws && ws.readyState === 1) {
      if (data.type === 'touch' && data.action === 2 && ws.bufferedAmount > 8192) {
        return; // Drop intermediate move events on buffer congestion to eliminate rubber-banding latency
      }
      ws.send(JSON.stringify(data));
    } else {
      if (data.type === 'touch' && data.action === 2) return; // drop stale moves
      ctrlQueue.push(data);
      if (ctrlQueue.length > 8) ctrlQueue.splice(0, ctrlQueue.length - 8);
    }
  }

  function coords(e) {
    const r = canvas.getBoundingClientRect();
    let cx = 0, cy = 0;
    if (e.touches && e.touches.length > 0) {
      cx = e.touches[0].clientX;
      cy = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length > 0) {
      cx = e.changedTouches[0].clientX;
      cy = e.changedTouches[0].clientY;
    } else if (typeof e.clientX === 'number') {
      cx = e.clientX;
      cy = e.clientY;
    }
    
    // Use canvas size first (actual rendered), fall back to nativeW/H, then server defaults
    const canvasW = canvas.width || nativeW || ${screenW};
    const canvasH = canvas.height || nativeH || ${screenH};
    
    // rect dimensions (CSS pixels on screen)
    const rectW = r.width || canvasW;
    const rectH = r.height || canvasH;
    
    // Prevent division by zero
    if (rectW === 0 || rectH === 0) return { x: 0, y: 0, cx, cy, w: canvasW, h: canvasH };
    
    const x = Math.round((cx - r.left) * (canvasW / rectW));
    const y = Math.round((cy - r.top)  * (canvasH / rectH));
    
    return {
      x: Math.max(0, Math.min(canvasW - 1, x)),
      y: Math.max(0, Math.min(canvasH - 1, y)),
      cx, cy,
      w: canvasW,
      h: canvasH
    };
  }

  // ── Instant Native Touch & Pointer Mechanics ─────────────────────────
  let isNativeTouchActive = false;
  let lastMoveTime = 0;
  let lastX = -1, lastY = -1;

  function ensureActiveOnInteraction() {
    initAudio();
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().then(hideAudioResumePrompt).catch(function(){});
    }
    if (!hasKeyframe) {
      send({ type: 'request_keyframe' });
      send({ type: 'wake' });
    }
  }

  // Native Touch Listeners (Mobile / Tablet browsers with raw 0ms latency)
  function handleTouchStart(e) {
    isNativeTouchActive = true;
    e.preventDefault();
    ensureActiveOnInteraction();
    const c = coords(e);
    lastX = c.x; lastY = c.y;
    lastMoveTime = performance.now();
    send({ type: 'touch', action: 0, x: c.x, y: c.y, width: c.w, height: c.h, pressure: 0.5 });
  }

  function handleTouchMove(e) {
    if (!isNativeTouchActive) return;
    e.preventDefault();
    const now = performance.now();
    // 4ms micro-throttle allows ultra-responsive 240Hz touch sampling with instant in-hand response
    if (now - lastMoveTime < 4) return;
    const c = coords(e);
    if (Math.abs(c.x - lastX) < 0.5 && Math.abs(c.y - lastY) < 0.5) return;
    lastX = c.x; lastY = c.y;
    lastMoveTime = now;
    send({ type: 'touch', action: 2, x: c.x, y: c.y, width: c.w, height: c.h, pressure: 0.6 });
  }

  function handleTouchEnd(e) {
    if (!isNativeTouchActive) return;
    isNativeTouchActive = false;
    e.preventDefault();
    const c = coords(e);
    if (Math.abs(c.x - lastX) >= 0.5 || Math.abs(c.y - lastY) >= 0.5) {
      send({ type: 'touch', action: 2, x: c.x, y: c.y, width: c.w, height: c.h, pressure: 0.5 });
    }
    send({ type: 'touch', action: 1, x: c.x, y: c.y, width: c.w, height: c.h, pressure: 0 });
  }

  canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
  canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
  canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });

  // Mouse / Pointer Listeners (Desktop browsers with mouse / stylus)
  let isPointerDown = false;
  let activePointerId = null;

  canvas.addEventListener('pointerdown', (e) => {
    // If device is touch-driven, let touchstart handle it with 0ms latency
    if (e.pointerType === 'touch' || isNativeTouchActive) return;
    e.preventDefault();
    isPointerDown = true;
    activePointerId = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    ensureActiveOnInteraction();
    const c = coords(e);
    lastX = c.x; lastY = c.y;
    lastMoveTime = performance.now();
    send({ type: 'touch', action: 0, x: c.x, y: c.y, width: c.w, height: c.h, pressure: 0.5 });
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || isNativeTouchActive || !isPointerDown) return;
    e.preventDefault();
    const now = performance.now();
    if (now - lastMoveTime < 4) return;
    const c = coords(e);
    if (Math.abs(c.x - lastX) < 0.5 && Math.abs(c.y - lastY) < 0.5) return;
    lastX = c.x; lastY = c.y;
    lastMoveTime = now;
    send({ type: 'touch', action: 2, x: c.x, y: c.y, width: c.w, height: c.h, pressure: 0.6 });
  });

  let lastReleaseTime = 0;
  function releasePointer(e) {
    if (e.pointerType === 'touch' || isNativeTouchActive || !isPointerDown) return;
    isPointerDown = false;
    lastReleaseTime = performance.now();
    if (activePointerId !== null) {
      try { canvas.releasePointerCapture(activePointerId); } catch (_) {}
      activePointerId = null;
    }
    const c = coords(e);
    if (Math.abs(c.x - lastX) >= 0.5 || Math.abs(c.y - lastY) >= 0.5) {
      send({ type: 'touch', action: 2, x: c.x, y: c.y, width: c.w, height: c.h, pressure: 0.5 });
    }
    send({ type: 'touch', action: 1, x: c.x, y: c.y, width: c.w, height: c.h, pressure: 0 });
  }

  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  window.addEventListener('pointerup', releasePointer);

  canvas.addEventListener('click', (e) => {
    if (performance.now() - lastReleaseTime < 350) return;
    const c = coords(e);
    send({ type: 'tap', x: c.x, y: c.y, width: c.w, height: c.h });
  });

  // ── Ultra-Smooth Continuous Wheel Scrolling (35ms Responsive Bucket) ───
  let wheelAccum = 0;
  let wheelTimer = null;
  let lastWheelPos = null;

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    wheelAccum += e.deltaY;
    lastWheelPos = coords(e);

    if (!wheelTimer) {
      wheelTimer = setTimeout(() => {
        const d = wheelAccum;
        const c = lastWheelPos || { x: nativeW / 2, y: nativeH / 2 };
        wheelAccum = 0;
        wheelTimer = null;

        // Convert mouse wheel ticks into natural, fluid finger scroll strokes
        const scrollDist = Math.max(-550, Math.min(550, -d * 2.2));
        if (Math.abs(scrollDist) > 8) {
          const y1 = Math.max(120, Math.min(nativeH - 120, c.y));
          const y2 = Math.max(30, Math.min(nativeH - 30, y1 + scrollDist));
          const strokeDur = Math.max(50, Math.min(130, Math.round(Math.abs(scrollDist) * 0.25)));
          send({ type:'swipe', x1:c.x, y1:y1, x2:c.x, y2:y2, duration:strokeDur });
        }
      }, 35);
    }
  }, { passive:false });

  // ── Keyboard handling (Spacebar protection & full Android keys) ────────
  document.addEventListener('keydown', (e) => {
    // Never intercept if typing into an input/textarea inside a modal dialog
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

    // Immediately blur any active button so Space cannot trigger click events on it
    if (document.activeElement && document.activeElement !== document.body && document.activeElement !== canvas) {
      document.activeElement.blur();
    }

    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      key(62); // Android KEYCODE_SPACE = 62
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      key(67); // Android KEYCODE_DEL = 67
    } else if (e.key === 'Enter') {
      e.preventDefault();
      key(66); // Android KEYCODE_ENTER = 66
    } else if (e.key === 'Escape') {
      e.preventDefault();
      key(4);  // Android KEYCODE_BACK = 4
    } else if (e.key === 'Tab') {
      e.preventDefault();
      key(61); // Android KEYCODE_TAB = 61
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      key(19);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      key(20);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      key(21);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      key(22);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      send({ type:'text', text:e.key });
    }
  });

  // Ensure all buttons instantly blur upon click or touch so they never retain keyboard focus
  window.addEventListener('pointerdown', (e) => {
    if (e.target && (e.target.tagName === 'BUTTON' || e.target.closest('button'))) {
      const btn = e.target.tagName === 'BUTTON' ? e.target : e.target.closest('button');
      setTimeout(() => { if (btn) btn.blur(); }, 0);
    }
  });
  window.addEventListener('click', (e) => {
    if (e.target && (e.target.tagName === 'BUTTON' || e.target.closest('button'))) {
      const btn = e.target.tagName === 'BUTTON' ? e.target : e.target.closest('button');
      setTimeout(() => { if (btn) btn.blur(); }, 0);
    }
  });

  function key(code) { send({ type:'code', code }); }
  function expandNotifications() { send({ type:'expand_notifications' }); }

  function screenshot() {
    const q = location.search ? location.search + '&t=' + Date.now() : '?t=' + Date.now();
    fetch('/screen.jpg' + q).then(r=>r.blob()).then(b=>{
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'shot-${serial}-'+Date.now()+'.jpg';
      a.click();
    });
  }
  function reboot() { if(confirm('Reboot ${serial}?')) send({type:'reboot'}); }
  function openText() { document.getElementById('textModal').style.display='flex'; document.getElementById('textVal').focus(); }
  function doText() {
    const v = document.getElementById('textVal').value;
    if (v) { send({type:'text',text:v}); document.getElementById('textVal').value=''; }
    document.getElementById('textModal').style.display='none';
  }
  function openUpload() { document.getElementById('uploadModal').style.display='flex'; }
  function doUpload() {
    const f = document.getElementById('filePick').files[0];
    if (!f) return alert('Pick a file first');
    const fd = new FormData(); fd.append('file', f);
    fetch('/upload',{method:'POST',body:fd}).then(r=>r.json())
      .then(()=>{ alert(f.name+' uploaded!'); document.getElementById('uploadModal').style.display='none'; })
      .catch(()=>alert('Upload failed'));
  }
  function setVolume(val) {
    const v = parseFloat(val);
    currentVolume = v;
    if (v > 0 && isMuted) {
      isMuted = false;
    } else if (v === 0) {
      isMuted = true;
    }
    initAudio();
    if (gainNode) {
      gainNode.gain.value = isMuted ? 0 : (currentVolume / 100);
    }
    if (!isMuted && audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().then(hideAudioResumePrompt).catch(function(){});
    }
    syncMuteUI();
  }

  function rotateScreen() {
    send({ type: 'code', code: 275 });
    setTimeout(() => send({ type: 'wake' }), 250);
  }

  function reconnectStream() {
    const mt = document.getElementById('modeText');
    if (mt) mt.textContent = 'RECONNECTING';
    resetDecoder();
    connectWS();
  }

  function toggleDebugModal() {
    const modal = document.getElementById('debugModal');
    if (modal) {
      const res = document.getElementById('dbgRes');
      if (res) res.textContent = (canvas.width || nativeW) + ' x ' + (canvas.height || nativeH);
      const wsSt = document.getElementById('dbgWs');
      if (wsSt) wsSt.textContent = wsOk ? 'CONNECTED' : 'DISCONNECTED';
      const codec = document.getElementById('dbgCodec');
      if (codec) codec.textContent = typeof VideoDecoder !== 'undefined' ? 'WebCodecs H264 (Hardware)' : 'Fallback Canvas';
      modal.style.display = modal.style.display === 'flex' ? 'none' : 'flex';
    }
  }

  function popOutWindow() {
    const isMobile = typeof window !== 'undefined' && (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth <= 768);
    if (isMobile) {
      window.open(window.location.href, '_blank');
      return;
    }
    const isWide = (canvas.width > canvas.height) || (nativeW > nativeH);
    const screenW = window.screen.availWidth || window.screen.width || 1280;
    const screenH = window.screen.availHeight || window.screen.height || 900;
    const width = Math.min(screenW - 20, isWide ? 1080 : 520);
    const height = Math.min(screenH - 40, isWide ? 760 : 940);
    const left = Math.max(0, Math.round((screenW - width) / 2));
    const top = Math.max(0, Math.round((screenH - height) / 2));
    window.open(window.location.href, 'Stream_${serial}', 'width=' + width + ',height=' + height + ',top=' + top + ',left=' + left + ',resizable=yes,scrollbars=no,status=no,location=no,toolbar=no,menubar=no,popup=yes');
  }

  window.addEventListener('click', e => { if (e.target.classList.contains('modal')) e.target.style.display='none'; });

  connectWS();
</script>
</body>
</html>`;
}


// ─── startStreamServer ───────────────────────────────────────────────────────


async function startStreamServer(serial, port, aliasSerial) {
  logger.info(`[StreamServer] Starting for ${serial} on port ${port}${aliasSerial ? ` (alias: ${aliasSerial})` : ''}`);

  // Start scrcpy engine asynchronously so stream server port listens immediately
  const engine = new ScrcpyEngine(serial);
  engine.enableAudio = true;  // Audio streams on dedicated independent channel
  const videoPort = port + 1000;
  engine.start(videoPort)
    .then(() => logger.info(`[StreamServer] ScrcpyEngine ready for ${serial}`))
    .catch((err) => logger.warn(`[StreamServer] ScrcpyEngine failed for ${serial}: ${err.message}`));


  // ── HTTP handler ──────────────────────────────────────────────────────────
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), interest-cohort=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:;");
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url, `http://localhost:${port}`);
    const p   = url.pathname;

    if (_isKillSwitchActive) {
      if (p === '/control' || p === '/upload' || p === '/screen.jpg') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Licence Revoked', kill_switch: true }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getStreamKillSwitchRevokedHtml(reqUdid || serial));
      return;
    }

    const reqUdid = (url.searchParams.get('udid') || '').trim();
    const candidateAuth = [
      url.searchParams.get('pin'),
      url.searchParams.get('key'),
      url.searchParams.get('token')
    ].filter(Boolean).map(s => s.trim());
    const isCctvView = url.searchParams.get('cctv') === '1' || url.searchParams.get('view') === 'cctv';

    // 1. Bare domain or no UDID provided -> show the 5 auto-sliding cards presentation
    if (!reqUdid) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildVertexCardsHtml(null, null, false));
      return;
    }

    // 2. Identify active target session for requested device
    const targetSession = findActiveSession(reqUdid, serial);
    if (!targetSession) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildVertexCardsHtml(reqUdid, candidateAuth[0] || '', true, `Device ${reqUdid} is offline or no active session exists.`));
      return;
    }

    const effectiveSerial = targetSession.serial || serial;
    const effectiveEngine = targetSession.engine || engine;

    // 3. Server-side token / PIN verification (Seed Admin Key or Assigned Worker PIN required)
    const isAuthorized = await verifyDeviceAccess(effectiveSerial, candidateAuth, isCctvView);
    if (!isAuthorized) {
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildVertexCardsHtml(
        effectiveSerial,
        candidateAuth[0] || '',
        true,
        `Access Denied for ${effectiveSerial}. Direct stream control is strictly restricted to Seed Admin or the specific user assigned to this device. Admins and Super Admins must view devices via the CCTV Wall.`
      ));
      return;
    }

    // Handle file upload
    if (p === '/upload' && req.method === 'POST') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const tmp = path.join(process.cwd(), `upload_${Date.now()}.tmp`);
        fs.writeFileSync(tmp, Buffer.concat(chunks));
        const dest = `/sdcard/Download/media_${Date.now()}.jpg`;
        exec(`"${ADB_BIN}" -s ${effectiveSerial} push "${tmp}" "${dest}"`, () => {
          try { fs.unlinkSync(tmp); } catch (_) {}
          exec(`"${ADB_BIN}" -s ${effectiveSerial} shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${dest}`);
          res.writeHead(200, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ status:'ok' }));
        });
      });
      return;
    }

    // Screenshot endpoint
    if (p === '/screen.jpg') {
      const frame = await captureOneFrame(effectiveSerial);
      if (frame) { res.writeHead(200, {'Content-Type':'image/png','Cache-Control':'no-cache'}); res.end(frame); }
      else        { res.writeHead(500); res.end('Capture error'); }
      return;
    }

    // Control endpoint
    if (p === '/control') {
      handleControl(url.searchParams.get('type'), url.searchParams, effectiveSerial, effectiveEngine);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end('{"status":"ok"}');
      return;
    }

    // Trigger auto-sync / GitHub pull
    if (p === '/sync' || p === '/api/system/sync') {
      try {
        const autoSync = require('./auto-sync-service');
        if (autoSync && typeof autoSync.checkAndSyncGithub === 'function') {
          autoSync.checkAndSyncGithub().catch(() => {});
        }
      } catch (_) {}
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end('{"status":"ok","message":"Sync initiated"}');
      return;
    }

    // Diagnostic endpoint
    if (p === '/diag' || p === '/api/debug/audio') {
      try {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          serial: effectiveSerial,
          enableAudio: !!effectiveEngine.enableAudio,
          hasAudioProc: !!effectiveEngine._audioProc,
          audioProcPid: effectiveEngine._audioProc ? effectiveEngine._audioProc.pid : null,
          hasAudioSocket: !!effectiveEngine.audioSocket,
          audioSocketDestroyed: effectiveEngine.audioSocket ? effectiveEngine.audioSocket.destroyed : null,
          audioCodec: effectiveEngine._audioCodec || null,
          audioPacketsSent: effectiveEngine._audioPacketsSent || 0,
          wsClientsCount: effectiveEngine.wsClients ? effectiveEngine.wsClients.size : 0,
          audioDebugLogs: effectiveEngine._audioDebugLogs || []
        }, null, 2));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // Render Stream Player
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    const playerW = effectiveEngine.videoWidth  > 0 ? effectiveEngine.videoWidth  : effectiveEngine.screenWidth;
    const playerH = effectiveEngine.videoHeight > 0 ? effectiveEngine.videoHeight : effectiveEngine.screenHeight;
    res.end(buildPlayerHtml(effectiveSerial, playerW, playerH));
  });

  // ── WebSocket — relay H264 + audio from scrcpy engine to browser ─────────
  const wss = new WebSocket.Server({ server, path: '/ws', perMessageDeflate: false });

  wss.on('connection', async (ws, req) => {

    try {
      await syncKillSwitchFromDb();
    } catch (_) {}

    if (_isKillSwitchActive) {
      try {
        ws.send(JSON.stringify({ type: 'kill_switch', active: true }));
        ws.send(JSON.stringify({ type: 'stream_revoked', reason: 'kill_switch' }));
      } catch (_) {}
      setTimeout(() => {
        try { ws.close(4003, 'Licence Permanently Revoked'); } catch (_) {}
      }, 200);
      return;
    }

    const wsUrl = new URL(req.url, 'http://localhost');
    const reqWsUdid = (wsUrl.searchParams.get('udid') || '').trim();
    const candidateWsAuth = [
      wsUrl.searchParams.get('pin'),
      wsUrl.searchParams.get('key'),
      wsUrl.searchParams.get('token')
    ].filter(Boolean).map(s => s.trim());
    const isWsCctv = wsUrl.searchParams.get('cctv') === '1' || wsUrl.searchParams.get('view') === 'cctv';

    if (!reqWsUdid) {
      ws.close(4000, 'Device UDID Required');
      return;
    }

    const targetWsSession = findActiveSession(reqWsUdid, serial);
    if (!targetWsSession) {
      ws.close(4004, 'Device Not Found Or Offline');
      return;
    }

    const effectiveWsSerial = targetWsSession.serial || serial;
    const effectiveWsEngine = targetWsSession.engine || engine;

    // Check credential on initial WS connection (Seed Admin Key or Assigned Worker PIN required)
    const isWsAuthorized = await verifyDeviceAccess(effectiveWsSerial, candidateWsAuth, isWsCctv);
    if (!isWsAuthorized) {
      logger.warn(`[StreamServer] Unauthorized WS connection attempt for ${effectiveWsSerial}`);
      try {
        ws.send(JSON.stringify({ type: 'stream_revoked', reason: 'Direct stream restricted to Seed Admin or assigned user only' }));
      } catch (_) {}
      ws.close(4003, 'Unauthorized / Expired Credentials');
      return;
    }

    logger.info(`[StreamServer] WS connected and authorized for ${effectiveWsSerial}`);
    effectiveWsEngine.addClient(ws);
    if (effectiveWsEngine.enableAudio && !effectiveWsEngine._audioProc && effectiveWsEngine.isRunning && typeof effectiveWsEngine._startDedicatedAudioStream === 'function') {
      effectiveWsEngine._startDedicatedAudioStream().catch(() => {});
    }

    // Heartbeat verification every 10 seconds: if admin resets PIN/key or unallocates, revoke stream
    const authWatcherTimer = setInterval(async () => {
      const stillAuthorized = await verifyDeviceAccess(effectiveWsSerial, candidateWsAuth, isWsCctv);
      if (!stillAuthorized) {
        logger.warn(`[StreamServer] Credentials revoked by admin for ${effectiveWsSerial}. Terminating active stream.`);
        try {
          ws.send(JSON.stringify({ type: 'stream_revoked', reason: 'Stream authorization revoked or reassigned' }));
        } catch (_) {}
        clearInterval(authWatcherTimer);
        effectiveWsEngine.removeClient(ws);
        ws.close(4003, 'Credentials Revoked');
      }
    }, 10000);

    // Heartbeat keepalive every 10 seconds to keep Cloudflare Tunnel & proxies active
    const wsHeartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping();
          ws.send(JSON.stringify({ type: 'heartbeat', time: Date.now() }));
        } catch (_) {}
      } else {
        clearInterval(wsHeartbeatTimer);
      }
    }, 10000);

    ws.on('message', (msg) => {
      if (_isKillSwitchActive) return;
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', time: Date.now() }));
          return;
        }
        if (data.type === 'pong' || data.type === 'heartbeat') {
          return;
        }
        if (data.type === 'request_keyframe') {
          // Send SPS/PPS config so decoder can initialize cleanly
          effectiveWsEngine.sendKeyframeToClient(ws);
          return;
        }
        if (data.type === 'wake' || data.type === 'refresh') {
          // Forwarded to handleControl below
        }
        handleControl(data.type, data, effectiveWsSerial, effectiveWsEngine);
      } catch (_) {}
    });

    const cleanup = () => {
      effectiveWsEngine.removeClient(ws);
      clearInterval(authWatcherTimer);
      clearInterval(wsHeartbeatTimer);
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.on('clientError', (err, socket) => {
      try {
        if (socket.writable) socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
      } catch (_) {}
    });
    server.listen(port, '0.0.0.0', () => {
      const localUrl = `http://localhost:${port}`;
      logger.info(`[StreamServer] Listening at ${localUrl}`);
      const sessionObj = { server, wss, engine, serial };
      activeServers.set(serial, sessionObj);
      if (aliasSerial && aliasSerial !== serial) {
        activeServers.set(aliasSerial, sessionObj);
      }

      const streamProcess = {
        pid: port, exitCode: null,
        kill() {
          engine.stop();
          try { wss.close(); } catch (_) {}
          server.close();
          activeServers.delete(serial);
          if (aliasSerial) activeServers.delete(aliasSerial);
        },
      };
      resolve({ streamProcess, localUrl });
    });
  });
}

// ─── Exports ─────────────────────────────────────────────────────────────────

function buildStreamUrl(tunnelDomain, port, serial) {
  const cleanDomain = (tunnelDomain || 'localhost:8100').replace(/\/+$/, '');
  const domain = cleanDomain.startsWith('http') ? cleanDomain : `https://${cleanDomain}`;
  return `${domain}/?udid=${encodeURIComponent(serial)}`;
}

function killStreamServer(streamProcess) {
  if (streamProcess && typeof streamProcess.kill === 'function') {
    try { streamProcess.kill(); } catch (_) {}
  }
}

module.exports = {
  startStreamServer,
  buildStreamUrl,
  killStreamServer,
  isKillSwitchActive,
  setKillSwitchActive,
  getStreamKillSwitchRevokedHtml,
};
