import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useKillSwitch } from '../context/KillSwitchContext';
import {
  ShieldAlert,
  Power,
  Lock,
  Unlock,
  AlertTriangle,
  ArrowLeft,
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────
// Password guards entry to this page from within the Seed Admin dashboard.
// Change this value here if you ever need to rotate it.
const KILL_SWITCH_PASSWORD = 'josephmwinzisamson';

// ─── LicenseKillSwitchPage ────────────────────────────────────────────────────
// A password-protected panel embedded inside SeedAdminDashboard that lets the
// seed admin activate or deactivate the global system kill switch.
//
// When active:
//   • Every non-seed-admin page is covered by <GlobalLockOverlay />.
//   • The desktop agent (index.js) receives the Supabase Realtime event and
//     immediately calls gracefulShutdown() to close all device streams.
//
// When deactivated:
//   • The overlay disappears instantly across all browser sessions.
//   • The agent reconnects and resumes normal operation.

export default function LicenseKillSwitchPage({ onBack }) {
  const { profile } = useAuth();
  const { isKillSwitchActive } = useKillSwitch();

  // ── Local UI state ──────────────────────────────────────────────────────────
  const [authenticated, setAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [toggling, setToggling] = useState(false);
  const [confirmModal, setConfirmModal] = useState(false); // ask before ACTIVATING
  const [pulse, setPulse] = useState(true);

  // Pulsing effect for the active state indicator
  useEffect(() => {
    const t = setInterval(() => setPulse(p => !p), 900);
    return () => clearInterval(t);
  }, []);

  // ── Password gate ───────────────────────────────────────────────────────────
  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (passwordInput === KILL_SWITCH_PASSWORD) {
      setAuthenticated(true);
      setPasswordError('');
    } else {
      setPasswordError('Incorrect password. Access denied.');
      setPasswordInput('');
    }
  };

  // ── Toggle the kill switch in Supabase ─────────────────────────────────────
  const applyToggle = async (newState) => {
    setToggling(true);
    setConfirmModal(false);
    try {
      const now = new Date().toISOString();
      const patch = {
        is_active: newState,
        updated_at: now,
        ...(newState
          ? { activated_by: profile?.email || 'seed_admin', activated_at: now }
          : { deactivated_at: now }),
      };
      const { error } = await supabase
        .from('system_kill_switch')
        .update(patch)
        .eq('id', 1);
      if (error) throw error;
      // The KillSwitchContext realtime listener will update isKillSwitchActive
      // globally within milliseconds — no local setState needed here.
    } catch (err) {
      alert('Error updating kill switch: ' + err.message);
    } finally {
      setToggling(false);
    }
  };

  const handleToggle = () => {
    if (isKillSwitchActive) {
      // Deactivating: no extra confirmation needed — admin wants to restore service
      applyToggle(false);
    } else {
      // Activating: show a hard confirmation modal first
      setConfirmModal(true);
    }
  };

  // ── Password gate screen ────────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <div
        style={{
          minHeight: '60vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <div
          style={{
            maxWidth: '420px',
            width: '100%',
            background: 'var(--bg-card)',
            border: '2px solid rgba(239,68,68,0.35)',
            borderRadius: '20px',
            padding: '40px 36px',
            boxShadow: '0 0 60px rgba(220,38,38,0.15)',
          }}
        >
          {/* Back link */}
          <button
            onClick={onBack}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              marginBottom: '24px',
              padding: 0,
            }}
          >
            <ArrowLeft size={14} /> Back to Dashboard
          </button>

          {/* Icon */}
          <div
            style={{
              width: '72px',
              height: '72px',
              borderRadius: '20px',
              background: 'rgba(239,68,68,0.12)',
              border: '2px solid rgba(239,68,68,0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
            }}
          >
            <ShieldAlert size={34} color="#ef4444" />
          </div>

          <h2
            style={{
              fontSize: '22px',
              fontWeight: 800,
              color: '#ef4444',
              textAlign: 'center',
              marginBottom: '8px',
            }}
          >
            Restricted Area
          </h2>
          <p
            style={{
              color: 'var(--text-muted)',
              textAlign: 'center',
              fontSize: '13px',
              marginBottom: '28px',
              lineHeight: '1.6',
            }}
          >
            This section requires the Seed Admin master override password.
          </p>

          <form onSubmit={handlePasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <input
              type="password"
              className="input-field"
              placeholder="Enter master override password"
              value={passwordInput}
              onChange={e => { setPasswordInput(e.target.value); setPasswordError(''); }}
              autoFocus
              style={{ letterSpacing: '2px' }}
            />
            {passwordError && (
              <div
                style={{
                  color: '#ef4444',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <AlertTriangle size={13} /> {passwordError}
              </div>
            )}
            <button
              type="submit"
              className="btn btn-danger"
              style={{ fontWeight: 700, padding: '12px' }}
            >
              <Lock size={15} /> Authenticate
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Main kill switch panel ──────────────────────────────────────────────────
  return (
    <div style={{ padding: '4px 0' }}>
      {/* Back link */}
      <button
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '13px',
          marginBottom: '24px',
          padding: 0,
        }}
      >
        <ArrowLeft size={14} /> Back to Dashboard
      </button>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '28px' }}>
        <ShieldAlert size={28} color="#ef4444" />
        <div>
          <h2 style={{ fontSize: '22px', fontWeight: 800, color: '#ef4444', lineHeight: 1 }}>
            Global System Kill Switch
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
            Instantly locks or unlocks the entire platform across all devices and users in real time.
          </p>
        </div>
      </div>

      {/* Status card */}
      <div
        className="card"
        style={{
          border: isKillSwitchActive
            ? `2px solid ${pulse ? 'rgba(239,68,68,0.9)' : 'rgba(239,68,68,0.35)'}`
            : '2px solid rgba(16,185,129,0.4)',
          boxShadow: isKillSwitchActive
            ? `0 0 ${pulse ? 60 : 20}px rgba(220,38,38,${pulse ? 0.35 : 0.1})`
            : '0 0 20px rgba(16,185,129,0.08)',
          transition: 'border-color 0.9s ease, box-shadow 0.9s ease',
          marginBottom: '28px',
        }}
      >
        {/* Current state badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 16px',
            borderRadius: '20px',
            marginBottom: '20px',
            fontWeight: 800,
            fontSize: '12px',
            letterSpacing: '1px',
            textTransform: 'uppercase',
            background: isKillSwitchActive
              ? 'rgba(239,68,68,0.15)'
              : 'rgba(16,185,129,0.12)',
            border: isKillSwitchActive
              ? '1px solid rgba(239,68,68,0.4)'
              : '1px solid rgba(16,185,129,0.3)',
            color: isKillSwitchActive ? '#ef4444' : '#10b981',
          }}
        >
          {isKillSwitchActive ? (
            <><Lock size={13} /> KILL SWITCH ACTIVE — SYSTEM LOCKED</>
          ) : (
            <><Unlock size={13} /> KILL SWITCH OFF — SYSTEM RUNNING</>
          )}
        </div>

        {/* Description */}
        <p
          style={{
            color: isKillSwitchActive ? '#fca5a5' : 'var(--text-muted)',
            fontSize: '14px',
            lineHeight: '1.7',
            marginBottom: '28px',
          }}
        >
          {isKillSwitchActive ? (
            <>
              <strong style={{ color: '#ef4444' }}>The system is currently LOCKED.</strong>
              <br />
              All users see the "Licence Permanently Revoked" alarm screen. All device
              streams on every host computer have been shut down by the desktop agent.
              Toggle the switch below to restore access instantly.
            </>
          ) : (
            <>
              The system is <strong style={{ color: '#10b981' }}>running normally</strong>.
              Toggling the kill switch ON will immediately display the "Licence Permanently
              Revoked" alarm to every user and signal all desktop agents to close device streams.
            </>
          )}
        </p>

        {/* The Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
          <button
            onClick={handleToggle}
            disabled={toggling}
            className={isKillSwitchActive ? 'btn btn-primary' : 'btn btn-danger'}
            style={{
              padding: '14px 36px',
              fontSize: '15px',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              letterSpacing: '0.3px',
              background: isKillSwitchActive
                ? 'linear-gradient(135deg, #064e3b, #059669)'
                : 'linear-gradient(135deg, #7f1d1d, #dc2626)',
              borderColor: 'transparent',
              boxShadow: isKillSwitchActive
                ? '0 4px 20px rgba(5,150,105,0.35)'
                : '0 4px 20px rgba(220,38,38,0.35)',
            }}
          >
            <Power size={18} />
            {toggling
              ? 'Updating...'
              : isKillSwitchActive
              ? '🟢 Restore System — Toggle Kill Switch OFF'
              : '🔴 Activate Kill Switch — Lock All Systems'}
          </button>
        </div>
      </div>

      {/* Info cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '16px',
        }}
      >
        {/* What happens when ON */}
        <div
          className="card"
          style={{ border: '1px solid rgba(239,68,68,0.2)', padding: '18px 20px' }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: 800,
              color: '#ef4444',
              textTransform: 'uppercase',
              letterSpacing: '0.8px',
              marginBottom: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Lock size={12} /> When Switch is ON
          </div>
          <ul
            style={{
              margin: 0,
              padding: '0 0 0 16px',
              fontSize: '13px',
              color: 'var(--text-muted)',
              lineHeight: '1.8',
            }}
          >
            <li>Full-screen red alarm overlay locks every page</li>
            <li>Desktop agents close all device streams instantly</li>
            <li>No user can log in or access any feature</li>
            <li>Real-time — takes effect in &lt;1 second globally</li>
          </ul>
        </div>

        {/* What happens when OFF */}
        <div
          className="card"
          style={{ border: '1px solid rgba(16,185,129,0.2)', padding: '18px 20px' }}
        >
          <div
            style={{
              fontSize: '11px',
              fontWeight: 800,
              color: '#10b981',
              textTransform: 'uppercase',
              letterSpacing: '0.8px',
              marginBottom: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Unlock size={12} /> When Switch is OFF
          </div>
          <ul
            style={{
              margin: 0,
              padding: '0 0 0 16px',
              fontSize: '13px',
              color: 'var(--text-muted)',
              lineHeight: '1.8',
            }}
          >
            <li>Red alarm overlay disappears immediately</li>
            <li>Desktop agents resume normal stream operations</li>
            <li>All user accounts and devices unblocked</li>
            <li>Real-time restore — takes effect in &lt;1 second</li>
          </ul>
        </div>
      </div>

      {/* Confirm Activation Modal */}
      {confirmModal && (
        <div className="modal-overlay" onClick={() => setConfirmModal(false)}>
          <div
            className="modal-box"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '460px', border: '2px solid rgba(239,68,68,0.5)' }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '14px',
                color: '#ef4444',
              }}
            >
              <AlertTriangle size={24} />
              <h3 style={{ fontSize: '18px', fontWeight: 800 }}>Confirm Kill Switch Activation</h3>
            </div>
            <p
              style={{
                color: 'var(--text-muted)',
                fontSize: '14px',
                lineHeight: '1.7',
                marginBottom: '24px',
              }}
            >
              You are about to <strong style={{ color: '#ef4444' }}>lock the entire system</strong>.
              Every active user will immediately see the "Licence Permanently Revoked" alarm screen
              and all desktop agents will shut down device streams.
              <br /><br />
              Only toggle this ON if you intend to suspend platform access. You can reverse it at
              any time from this same page.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setConfirmModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={() => applyToggle(true)}
                disabled={toggling}
                style={{
                  background: 'linear-gradient(135deg, #7f1d1d, #dc2626)',
                  borderColor: 'transparent',
                  fontWeight: 800,
                }}
              >
                <Power size={14} /> Yes, Lock All Systems
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

