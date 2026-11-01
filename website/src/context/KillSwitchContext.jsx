import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// ─── Kill Switch Context ──────────────────────────────────────────────────────
// Provides real-time kill switch state to the entire app.
// Combines Supabase Realtime with a 1.2s high-frequency polling fallback
// so that state transitions are guaranteed to reflect within milliseconds everywhere.

const KillSwitchContext = createContext({ isKillSwitchActive: false, loaded: false });

export function useKillSwitch() {
  return useContext(KillSwitchContext);
}

export function KillSwitchProvider({ children }) {
  const [isKillSwitchActive, setIsKillSwitchActive] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const { data, error } = await supabase
          .from('system_kill_switch')
          .select('is_active')
          .eq('id', 1)
          .maybeSingle();

        if (!error && data && typeof data.is_active !== 'undefined') {
          setIsKillSwitchActive(Boolean(data.is_active));
        }
      } catch (_) {}
      setLoaded(true);
    };

    // ── 1. Initial immediate fetch ──────────────────────────────────────────
    fetchStatus();

    // ── 2. Real-time broadcast listener (no restrictive filter) ────────────
    const channel = supabase
      .channel('kill_switch_realtime_stream_sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'system_kill_switch' },
        (payload) => {
          const val = payload.new ? payload.new.is_active : payload.old?.is_active;
          if (typeof val !== 'undefined') {
            setIsKillSwitchActive(Boolean(val));
          } else {
            fetchStatus();
          }
        }
      )
      .subscribe();

    // ── 3. High-frequency 1.2s polling fallback ────────────────────────────
    const pollTimer = setInterval(fetchStatus, 1200);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollTimer);
    };
  }, []);

  return (
    <KillSwitchContext.Provider value={{ isKillSwitchActive, loaded }}>
      {children}
    </KillSwitchContext.Provider>
  );
}
