import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// ─── Kill Switch Context ──────────────────────────────────────────────────────
// Provides real-time kill switch state to the entire app.
// When `isKillSwitchActive` is true every page (except the seed admin kill
// switch panel itself) is covered by the GlobalLockOverlay.

const KillSwitchContext = createContext({ isKillSwitchActive: false });

export function useKillSwitch() {
  return useContext(KillSwitchContext);
}

export function KillSwitchProvider({ children }) {
  const [isKillSwitchActive, setIsKillSwitchActive] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // ── 1. Initial fetch ────────────────────────────────────────────────────
    supabase
      .from('system_kill_switch')
      .select('is_active')
      .eq('id', 1)
      .single()
      .then(({ data }) => {
        if (data) setIsKillSwitchActive(Boolean(data.is_active));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));

    // ── 2. Real-time subscription ───────────────────────────────────────────
    // Fires instantly whenever seed admin toggles the switch in Supabase.
    const channel = supabase
      .channel('kill_switch_realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'system_kill_switch', filter: 'id=eq.1' },
        (payload) => {
          setIsKillSwitchActive(Boolean(payload.new?.is_active));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <KillSwitchContext.Provider value={{ isKillSwitchActive, loaded }}>
      {children}
    </KillSwitchContext.Provider>
  );
}

