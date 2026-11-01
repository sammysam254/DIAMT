'use strict';

/**
 * kill-switch-service.js
 *
 * Listens to the Supabase Realtime channel and maintains a 1.5-second polling
 * fallback for changes to the `system_kill_switch` table (singleton row id=1).
 *
 * Automatically resolves Supabase credentials from config.json or environment.
 *
 * • When is_active flips TRUE  → calls onActivate()   (freezes all device streams & controls, displays pulsing red revoked licence screen)
 * • When is_active flips FALSE → calls onDeactivate() (unfreezes and resumes all streams instantly in real time)
 */

const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

let _channel = null;
let _client = null;
let _pollTimer = null;
let _isKillSwitchActive = false;

function loadConfig() {
  const candidates = [
    path.join(process.cwd(), 'config.json'),
    path.join(__dirname, '..', '..', 'config.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (_) {}
    }
  }
  return {};
}

function isKillSwitchActive() {
  return _isKillSwitchActive;
}

function setKillSwitchActive(state) {
  _isKillSwitchActive = Boolean(state);
}

/**
 * Start listening for kill switch changes.
 *
 * @param {string}   [inputUrl]
 * @param {string}   [inputKey]
 * @param {{ onActivate: Function, onDeactivate: Function }} callbacks
 */
async function startKillSwitchListener(inputUrl, inputKey, callbacks) {
  const cfg = loadConfig();
  const supabaseUrl = inputUrl || process.env.SUPABASE_URL || cfg.supabaseUrl || 'https://xbolsgcntkfzzpqnulsa.supabase.co';
  const supabaseKey = inputKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || cfg.supabaseServiceRoleKey || cfg.supabaseAnonKey;

  if (!supabaseUrl || !supabaseKey) {
    logger.warn('[KillSwitch] Missing Supabase credentials — kill switch listener not started');
    return;
  }

  try {
    _client = createClient(supabaseUrl, supabaseKey, {
      realtime: { params: { eventsPerSecond: 10 } },
    });

    const checkState = async () => {
      try {
        const { data, error } = await _client
          .from('system_kill_switch')
          .select('is_active')
          .eq('id', 1)
          .maybeSingle();

        if (!error && data && typeof data.is_active !== 'undefined') {
          const remoteState = Boolean(data.is_active);
          if (remoteState !== _isKillSwitchActive) {
            _isKillSwitchActive = remoteState;
            if (remoteState) {
              logger.warn('[KillSwitch] ⚠ Global Kill Switch is ACTIVE — freezing all device streams and controls');
              if (typeof callbacks?.onActivate === 'function') callbacks.onActivate();
            } else {
              logger.info('[KillSwitch] ✅ Global Kill Switch is DEACTIVATED — resuming all device streams in real time');
              if (typeof callbacks?.onDeactivate === 'function') callbacks.onDeactivate();
            }
          }
        }
      } catch (e) {
        // Silently retry on next cycle
      }
    };

    // ── 1. Initial State Check ─────────────────────────────────────────────
    await checkState();

    // ── 2. Real-time Subscription (no restrictive filter) ─────────────────
    _channel = _client
      .channel('agent_kill_switch_sync')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'system_kill_switch',
        },
        (payload) => {
          const val = payload.new ? payload.new.is_active : payload.old?.is_active;
          if (typeof val !== 'undefined') {
            const newState = Boolean(val);
            if (newState !== _isKillSwitchActive) {
              _isKillSwitchActive = newState;
              if (newState) {
                logger.warn('[KillSwitch Realtime] ⚠ Global Kill Switch ACTIVATED — freezing all device streams & controls');
                if (typeof callbacks?.onActivate === 'function') callbacks.onActivate();
              } else {
                logger.info('[KillSwitch Realtime] ✅ Global Kill Switch DEACTIVATED — unfreezing and resuming all device streams');
                if (typeof callbacks?.onDeactivate === 'function') callbacks.onDeactivate();
              }
            }
          } else {
            checkState();
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          logger.info('[KillSwitch] Real-time kill switch listener active');
        }
      });

    // ── 3. High-Frequency 1.5s Polling Fallback ───────────────────────────
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(checkState, 1500);

  } catch (err) {
    logger.warn('[KillSwitch] Failed to start kill switch listener:', err.message);
  }
}

/**
 * Stop the listener and clear timers.
 */
async function stopKillSwitchListener() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  if (_channel && _client) {
    try {
      await _client.removeChannel(_channel);
    } catch (_) {}
    _channel = null;
  }
}

module.exports = {
  startKillSwitchListener,
  stopKillSwitchListener,
  isKillSwitchActive,
  setKillSwitchActive,
};
