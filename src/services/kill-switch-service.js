'use strict';

/**
 * kill-switch-service.js
 *
 * Listens to the Supabase Realtime channel for changes to the
 * `system_kill_switch` table (singleton row id=1).
 *
 * • When is_active flips TRUE  → calls onActivate()   (holds all streams, serves pulsing red revoked licence screen)
 * • When is_active flips FALSE → calls onDeactivate() (unblocks all streams instantly in real time)
 */

const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

let _channel = null;
let _client = null;
let _isKillSwitchActive = false;

function isKillSwitchActive() {
  return _isKillSwitchActive;
}

function setKillSwitchActive(state) {
  _isKillSwitchActive = Boolean(state);
}

/**
 * Start listening for kill switch changes.
 *
 * @param {string}   supabaseUrl
 * @param {string}   supabaseKey
 * @param {{ onActivate: Function, onDeactivate: Function }} callbacks
 */
async function startKillSwitchListener(supabaseUrl, supabaseKey, callbacks) {
  if (!supabaseUrl || !supabaseKey) {
    logger.warn('[KillSwitch] Missing Supabase credentials — kill switch listener not started');
    return;
  }

  try {
    _client = createClient(supabaseUrl, supabaseKey, {
      realtime: { params: { eventsPerSecond: 10 } },
    });

    // ── 1. Fetch current state on startup ──────────────────────────────────
    try {
      const { data, error } = await _client
        .from('system_kill_switch')
        .select('is_active')
        .eq('id', 1)
        .single();

      if (!error && data?.is_active === true) {
        _isKillSwitchActive = true;
        logger.warn('[KillSwitch] Kill switch is ACTIVE on startup — holding all device streams in revoked licence state');
        if (typeof callbacks?.onActivate === 'function') {
          callbacks.onActivate();
        }
      } else {
        _isKillSwitchActive = false;
        logger.info('[KillSwitch] System licence status: CLEAR — streams active');
      }
    } catch (e) {
      logger.warn('[KillSwitch] Initial status check warning:', e.message);
    }

    // ── 2. Subscribe to real-time changes ─────────────────────────────────
    _channel = _client
      .channel('agent_kill_switch_watch')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'system_kill_switch',
          filter: 'id=eq.1',
        },
        (payload) => {
          const newState = Boolean(payload?.new?.is_active);
          _isKillSwitchActive = newState;

          if (newState) {
            logger.warn('[KillSwitch] ⚠ KILL SWITCH ACTIVATED by Seed Admin — placing all device streams on hold with red revoked licence screen');
            if (typeof callbacks?.onActivate === 'function') {
              callbacks.onActivate();
            }
          } else {
            logger.info('[KillSwitch] ✅ Kill switch DEACTIVATED by Seed Admin — instantly unblocking and resuming all device streams');
            if (typeof callbacks?.onDeactivate === 'function') {
              callbacks.onDeactivate();
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          logger.info('[KillSwitch] Real-time kill switch listener active');
        } else if (status === 'CHANNEL_ERROR') {
          logger.warn('[KillSwitch] Real-time channel error — will reconnect automatically');
        }
      });
  } catch (err) {
    logger.warn('[KillSwitch] Failed to start kill switch listener:', err.message);
  }
}

/**
 * Stop the listener and remove the Supabase realtime channel.
 */
async function stopKillSwitchListener() {
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
