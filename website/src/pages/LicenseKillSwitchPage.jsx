import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '../layouts/DashboardLayout';
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
  KeyRound,
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────
// Password guards entry to this page from within the Seed Admin dashboard.
const KILL_SWITCH_PASSWORD = 'josephmwinzisamson';

// ─── LicenseKillSwitchPage ────────────────────────────────────────────────────
// Dedicated page in Seed Admin dashboard accessible only by entering the master password.
// Hosts the switch that terminates/resumes global licence access across all
// browser clients and desktop agents in real-time.

export default function LicenseKillSwitchPage({ onBack }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { isKillSwitchActive } = useKillSwitch();

  const handleBack = () => {
    if (typeof onBack === 'function') {
      onBack();
    } else {
      navigate('/seed-admin');
    }
  };

  // ── Local UI state ──────────────────────────────────────────────────────────
  const [authenticated, setAuthenticated] = useState(() => {
    return sessionStorage.getItem('seed_kill_switch_auth') === 'true';
  });
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [toggling, setToggling] = useState(false);
  const [confirmModal, setConfirmModal] = useState(false);
  const [pulse, setPulse] = useState(true);

  // Pulsing effect for the active state indicator
  useEffect(() => {
    const t = setInterval(() => setPulse(p => !p), 900);
    return () => clearInterval(t);
  }, []);

  // ── Password gate ───────────────────────────────────────────────────────────
  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (passwordInput.trim() === KILL_SWITCH_PASSWORD) {
      setAuthenticated(true);
      sessionStorage.setItem('seed_kill_switch_auth', 'true');
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
    } catch (err) {
      alert('Error updating kill switch: ' + err.message);
    } finally {
      setToggling(false);
    }
  };

  const handleToggle = () => {
    if (isKillSwitchActive) {
      applyToggle(false);
    } else {
      setConfirmModal(true);
    }
  };

  // ── Password gate screen ────────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <DashboardLayout>
        <div
          style={{
            minHeight: '70vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div
            style={{
              maxWidth: '440px',
              width: '100%',
              background: 'var(--bg-card)',
              border: '2px solid rgba(239,68,68,0.35)',
              borderRadius: '24px',
              padding: '40px 36px',
              boxShadow: '0 0 60px rgba(220,38,38,0.18)',
            }}
          >
            {/* Back button */}
            <button
              onClick={handleBack}
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
              <ArrowLeft size={14} /> Back to Seed Owner Hub
            </button>

            {/* Icon */}
            <div
              style={{
                width: '76px',
                height: '76px',
                borderRadius: '22px',
                background: 'rgba(239,68,68,0.12)',
                border: '2px solid rgba(239,68,68,0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
              }}
            >
              <KeyRound size={36} color="#ef4444" />
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
              Seed Admin Authorization
            </h2>
            <p
              style={{
                color: 'var(--text-muted)',
                textAlign: 'center',
                fontSize: '13px',
                marginBottom: '26px',
                lineHeight: '1.6',
              }}
            >
              This dedicated emergency kill switch panel is strictly restricted. Enter the master override password to proceed.
            </p>

            <form onSubmit={handlePasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <input
                type="password"
                className="input-field"
                placeholder="Enter password..."
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
                style={{
                  fontWeight: 700,
                  padding: '12px',
                  background: 'linear-gradient(135deg, #7f1d1d, #dc2626)',
                  borderColor: 'transparent',
                }}
              >
                <Lock size={15} /> Unlock Control Panel
              </button>
            </form>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // ── Main kill switch panel ──────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div style={{ padding: '4px 0' }}>
        {/* Back link */}
        <button
          onClick={handleBack}
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
          <ArrowLeft size={14} /> Back to Seed Owner Hub
        </button>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '28px' }}>
          <ShieldAlert size={32} color="#ef4444" />
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#ef4444', lineHeight: 1.1 }}>
              Global System Kill Switch
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
              Dedicated Seed Admin panel: locks or unlocks all streams, agents, and user accounts in real time.
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
              <><Lock size={13} /> KILL SWITCH ACTIVE — SYSTEM CRASHED / LOCKED</>
            ) : (
              <><Unlock size={13} /> KILL SWITCH OFF — ALL SYSTEMS NORMAL</>
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
                <strong style={{ color: '#ef4444' }}>The system is currently CRASHED & LOCKED.</strong>
                <br />
                All browser users immediately see the pulsing red alarm banner: <b style={{ color: '#ef4444' }}>"LICENCE PERMANENTLY REVOKED"</b>. All desktop agents on hosting machines auto-terminate and lock all device streams until you toggle this OFF.
              </>
            ) : (
              <>
                The system is <strong style={{ color: '#10b981' }}>running normally</strong>.
                Toggling the kill switch ON will immediately force all hosting agents to close, block all streams, and show the red pulsing revoked licence alarm to every user.
              </>
            )}
          </p>

          {/* Master Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
            <button
              onClick={handleToggle}
              disabled={toggling}
              className={isKillSwitchActive ? 'btn btn-primary' : 'btn btn-danger'}
              style={{
                padding: '16px 40px',
                fontSize: '15px',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                letterSpacing: '0.4px',
                background: isKillSwitchActive
                  ? 'linear-gradient(135deg, #064e3b, #059669)'
                  : 'linear-gradient(135deg, #7f1d1d, #dc2626)',
                borderColor: 'transparent',
                boxShadow: isKillSwitchActive
                  ? '0 4px 20px rgba(5,150,105,0.4)'
                  : '0 4px 25px rgba(220,38,38,0.4)',
                cursor: 'pointer',
              }}
            >
              <Power size={20} />
              {toggling
                ? 'Updating Status...'
                : isKillSwitchActive
                ? '🟢 UNBLOCK & RESTORE — Toggle Kill Switch OFF'
                : '🔴 CRASH & LOCK SYSTEM — Toggle Kill Switch ON'}
            </button>
          </div>
        </div>

        {/* Feature Comparison Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '16px',
          }}
        >
          <div
            className="card"
            style={{ border: '1px solid rgba(239,68,68,0.25)', padding: '20px' }}
          >
            <div
              style={{
                fontSize: '12px',
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
              <Lock size={14} /> When Switch is ON (Crashed)
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
              <li>Pulsing red screen: "LICENCE PERMANENTLY REVOKED"</li>
              <li>Hosting agents auto-close and block all streams</li>
              <li>Setup script rejects launch if re-run on client machine</li>
              <li>Instant real-time enforcement across all devices</li>
            </ul>
          </div>

          <div
            className="card"
            style={{ border: '1px solid rgba(16,185,129,0.25)', padding: '20px' }}
          >
            <div
              style={{
                fontSize: '12px',
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
              <Unlock size={14} /> When Switch is OFF (Restored)
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
              <li>Pulsing red alarm disappears in real-time</li>
              <li>Desktop agents receive unblock and relaunch streams</li>
              <li>All user dashboard views return to active state</li>
              <li>Setup script permits startup and device connection</li>
            </ul>
          </div>
        </div>

        {/* Modal for Hard Confirmation */}
        {confirmModal && (
          <div className="modal-overlay" onClick={() => setConfirmModal(false)}>
            <div
              className="modal-box"
              onClick={e => e.stopPropagation()}
              style={{ maxWidth: '480px', border: '2px solid rgba(239,68,68,0.5)' }}
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
                <h3 style={{ fontSize: '18px', fontWeight: 800 }}>Confirm Emergency Crash & Lock</h3>
              </div>
              <p
                style={{
                  color: 'var(--text-muted)',
                  fontSize: '14px',
                  lineHeight: '1.7',
                  marginBottom: '24px',
                }}
              >
                Are you sure you want to trigger the global kill switch?
                <br /><br />
                The system will immediately crash with <strong style={{ color: '#ef4444' }}>"LICENCE PERMANENTLY REVOKED"</strong> on all screens and every desktop agent will close and lock all device streams.
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
                  <Power size={14} /> Yes, Crash & Lock System
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
