import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import DashboardLayout from '../layouts/DashboardLayout';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { 
  Smartphone, Lock, Unlock, ExternalLink, RefreshCw, Eye, EyeOff, 
  AlertCircle, DollarSign, Award, AlertTriangle, CheckCircle2, ChevronRight 
} from 'lucide-react';
import SEO from '../components/SEO';
import DiamtLoader from '../components/DiamtLoader';
import { getISOWeekString } from '../lib/weekUtils';

export default function WorkerDashboard() {
  const { profile } = useAuth();
  const [assignments, setAssignments] = useState([]);
  const [weekClaims, setWeekClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unlockModal, setUnlockModal] = useState(null);
  const [inputPassword, setInputPassword] = useState('');
  const [error, setError] = useState(null);
  const [revealedPasswords, setRevealedPasswords] = useState({});

  const currentWeek = getISOWeekString();

  const loadData = async (isInitial = false) => {
    if (!profile) return;
    if (isInitial) setLoading(true);
    try {
      const { data } = await supabase
        .from('device_assignments')
        .select('*, devices(*)')
        .eq('assigned_to_user_id', profile.id);

      const activeAssignments = (data || []).filter(a => {
        if (!a.devices) return false;
        if (a.devices.is_deleted_from_view) return false;
        return true;
      });
      setAssignments(activeAssignments);

      // Load claims for current week to track remaining target
      const { data: cData } = await supabase
        .from('worker_claims')
        .select('*')
        .eq('worker_id', profile.id)
        .eq('week_identifier', currentWeek);
      setWeekClaims(cData || []);
    } catch (e) {
      console.error('Error loading worker assignments:', e);
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    if (!profile) return;
    loadData(true);

    const channel = supabase
      .channel(`worker-realtime-${profile.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'device_assignments',
        filter: `assigned_to_user_id=eq.${profile.id}`,
      }, () => loadData(false))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'devices',
      }, () => loadData(false))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'worker_claims',
        filter: `worker_id=eq.${profile.id}`,
      }, () => loadData(false))
      .subscribe();

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadData(false);
      }
    }, 300000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, [profile]);

  const handleUnlock = (e) => {
    e.preventDefault();
    setError(null);

    if (inputPassword.trim() === unlockModal.access_password.trim()) {
      let streamUrl = unlockModal.devices?.stream_url;
      if (streamUrl) {
        try {
          const u = new URL(streamUrl);
          u.searchParams.set('pin', unlockModal.access_password.trim());
          streamUrl = u.toString();
        } catch (_) {
          streamUrl = streamUrl.replace(/([?&])pin=[^&]*/g, '$1');
          streamUrl += (streamUrl.includes('?') ? '&' : '?') + 'pin=' + encodeURIComponent(unlockModal.access_password.trim());
        }
        const w = 510, h = 900;
        const left = Math.max(0, Math.round((window.screen.width - w) / 2));
        const top = Math.max(0, Math.round((window.screen.height - h) / 2));
        window.open(streamUrl, `Stream_${unlockModal.devices?.serial || 'Device'}`, `width=${w},height=${h},top=${top},left=${left},resizable=yes,scrollbars=no,status=no,location=no,toolbar=no,menubar=no,popup=yes`);
      }
      setUnlockModal(null);
      setInputPassword('');
    } else {
      setError('Invalid password. Check with your admin.');
    }
  };

  const togglePasswordReveal = (assignmentId) => {
    setRevealedPasswords(prev => ({
      ...prev,
      [assignmentId]: !prev[assignmentId],
    }));
  };

  const isDeviceOnline = (d) => {
    if (!d || d.is_deleted_from_view) return false;
    if (d.status === 'offline') return false;
    if (d.status === 'online' && d.stream_url) return true;
    return Boolean(d.stream_url);
  };

  return (
    <DashboardLayout>
      <SEO
        title="Worker Control Dashboard — DIAMT Cloud"
        description="Assigned devices control center."
        noIndex={true}
      />
      <main aria-labelledby="worker-devices-heading">
        <header style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Smartphone size={24} color="var(--primary)" />
              <h1 id="worker-devices-heading" style={{ fontSize: '22px', fontWeight: 800 }}>My Assigned Devices</h1>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
            Devices assigned to you. Use your password to unlock and open the stream.
          </p>
        </div>
        <button onClick={() => loadData(true)} className="btn btn-secondary" aria-label="Refresh">
          <RefreshCw size={16} /> Refresh
        </button>
      </header>

      {/* Weekly Target & Claims Compliance Banner */}
      {(() => {
        const totalTarget = 40;
        const approvedAmount = (weekClaims || []).filter(c => c.status === 'approved').reduce((acc, c) => acc + Number(c.amount || 0), 0);
        const pendingAmount = (weekClaims || []).filter(c => c.status === 'pending').reduce((acc, c) => acc + Number(c.amount || 0), 0);
        const remainingAmount = Math.max(0, totalTarget - approvedAmount);
        const isCompliant = approvedAmount >= totalTarget;
        const claimsPlan = profile?.claims_plan === 'weekly' ? 'Weekly Plan ($40 Any Day)' : 'Daily Plan ($10 × 4)';

        return (
          <section className="card" style={{
            marginBottom: '24px',
            background: isCompliant 
              ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.08) 0%, rgba(16, 185, 129, 0.03) 100%)'
              : 'linear-gradient(135deg, rgba(239, 68, 68, 0.09) 0%, rgba(245, 158, 11, 0.05) 100%)',
            border: isCompliant 
              ? '1px solid rgba(34, 197, 94, 0.3)' 
              : '1px solid rgba(239, 68, 68, 0.35)',
            padding: '20px 24px',
            position: 'relative',
            overflow: 'hidden'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
              <div style={{ flex: '1 1 340px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <span style={{
                    padding: '4px 10px',
                    borderRadius: '999px',
                    fontSize: '11px',
                    fontWeight: 800,
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase',
                    background: isCompliant ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                    color: isCompliant ? '#22c55e' : '#ef4444',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px'
                  }}>
                    {isCompliant ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                    {isCompliant ? 'TARGET FULFILLED' : 'ACTION REQUIRED'}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Week {currentWeek} • Plan: <strong style={{ color: 'var(--text-main)' }}>{claimsPlan}</strong>
                  </span>
                </div>

                <h2 style={{ fontSize: '18px', fontWeight: 800, margin: '0 0 6px 0' }}>
                  {isCompliant 
                    ? `Weekly Target Accomplished ($${approvedAmount.toFixed(2)} / $${totalTarget.toFixed(2)})`
                    : `Remaining Weekly Target: $${remainingAmount.toFixed(2)} of $${totalTarget.toFixed(2)}`}
                </h2>

                <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5', margin: 0 }}>
                  {isCompliant ? (
                    <span style={{ color: '#22c55e' }}>
                      Excellent work! Your weekly $40 requirement has been verified by Admin. You are in good standing for this week.
                    </span>
                  ) : (
                    <span>
                      <strong style={{ color: '#ef4444' }}>Mandatory Rule & Consequence:</strong> You must achieve $40 in approved claims this week. Failure to hit the target will result in <strong>immediate system auto-suspension</strong> and <strong>mandatory departure from the station before tomorrow at 8:00 AM</strong>.
                    </span>
                  )}
                </p>

                {/* Progress Bar */}
                <div style={{ marginTop: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 700, marginBottom: '4px' }}>
                    <span>PROGRESS</span>
                    <span>${approvedAmount.toFixed(2)} approved {pendingAmount > 0 ? `(+$${pendingAmount.toFixed(2)} pending)` : ''} / ${totalTarget.toFixed(2)}</span>
                  </div>
                  <div style={{ height: '8px', background: 'rgba(255,255,255,0.08)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(100, Math.round((approvedAmount / totalTarget) * 100))}%`,
                      background: isCompliant ? '#22c55e' : 'linear-gradient(90deg, #f59e0b, #ef4444)',
                      borderRadius: '999px',
                      transition: 'width 0.4s ease'
                    }} />
                  </div>
                </div>
              </div>

              {/* Quick Action button to claims */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', gap: '8px' }}>
                <Link
                  to="/worker/claims"
                  className="btn btn-primary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 16px',
                    fontWeight: 700,
                    boxShadow: '0 4px 14px rgba(34, 197, 94, 0.25)'
                  }}
                >
                  <DollarSign size={16} /> Submit / View Claims <ChevronRight size={16} />
                </Link>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Realtime updates • Instant notifications
                </span>
              </div>
            </div>
          </section>
        );
      })()}

      {loading ? (
        <div style={{ padding: '48px 0' }}>
          <DiamtLoader text="LOCATING ASSIGNED DEVICES" subtext="Decrypting secure access tokens for worker node..." size="small" />
        </div>
      ) : assignments.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-muted)' }}>
          <Lock size={44} style={{ marginBottom: '14px', opacity: 0.4 }} />
          <h3 style={{ fontSize: '18px', fontWeight: 700 }}>No Devices Assigned</h3>
          <p style={{ fontSize: '13px', marginTop: '8px' }}>Your Admin has not assigned any device streams to your account yet.</p>
        </div>
      ) : (
        <div className="grid-cards">
          {assignments.map(a => {
            const online = isDeviceOnline(a.devices);
            const revealed = revealedPasswords[a.id];
            return (
              <div key={a.id} className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                  <div>
                    <h3 style={{ fontSize: '18px', fontWeight: 800 }}>
                      {a.devices?.brand} {a.devices?.model}
                    </h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '12px', fontFamily: 'monospace', marginTop: '3px' }}>
                      {a.devices?.serial}
                    </p>
                  </div>
                  <span className={`badge ${online ? 'badge-success' : 'badge-warning'}`} style={{ flexShrink: 0 }}>
                    {online ? '🟢 Online' : '🟡 Offline'}
                  </span>
                </div>

                {/* Password / PIN Row */}
                <div style={{
                  background: 'rgba(56,189,248,0.06)',
                  border: '1px solid rgba(56,189,248,0.15)',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: '14px',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}>
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '3px' }}>
                      YOUR ACCESS PIN (6-DIGIT)
                    </div>
                    <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '18px', letterSpacing: '3px', color: 'var(--primary)' }}>
                      {revealed ? (a.access_password || '------') : '••••••'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => togglePasswordReveal(a.id)}
                      className="btn btn-secondary"
                      style={{ padding: '6px 10px', fontSize: '12px' }}
                      title={revealed ? 'Hide PIN' : 'Show PIN'}
                    >
                      {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                      {revealed ? 'Hide' : 'Show'}
                    </button>
                    <button
                      onClick={() => {
                        if (a.access_password) {
                          navigator.clipboard.writeText(a.access_password);
                          alert('✅ 6-Digit PIN (' + a.access_password + ') copied to clipboard!');
                        }
                      }}
                      className="btn btn-primary"
                      style={{ padding: '6px 10px', fontSize: '12px' }}
                      title="Copy 6-Digit PIN to clipboard"
                    >
                      📋 Copy PIN
                    </button>
                  </div>
                </div>

                {/* Stream URL info */}
                {a.devices?.stream_url ? (
                  <div style={{
                    fontSize: '11px', fontFamily: 'monospace',
                    color: 'var(--text-muted)', wordBreak: 'break-all',
                    marginBottom: '14px', lineHeight: 1.5,
                  }}>
                    {a.devices.stream_url.substring(0, 60)}...
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px', color: 'var(--text-dim)', fontSize: '12px' }}>
                    <AlertCircle size={14} /> Device offline — stream link not yet available
                  </div>
                )}

                {/* Open Button */}
                <button
                  disabled={!online}
                  onClick={() => { setUnlockModal(a); setInputPassword(''); setError(null); }}
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', opacity: online ? 1 : 0.5 }}
                >
                  <Unlock size={16} />
                  {online ? 'Unlock & Open Device Stream' : 'Device Offline'}
                  {online && <ExternalLink size={14} />}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Password Unlock Modal */}
      {unlockModal && (
        <div className="modal-overlay" onClick={() => setUnlockModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Lock size={20} color="var(--primary)" /> Unlock Device Stream
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '16px' }}>
              Enter the password to open <b>{unlockModal.devices?.brand} {unlockModal.devices?.model}</b>.
            </p>

            {error && (
              <div style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '12px', padding: '8px', background: 'rgba(239,68,68,0.1)', borderRadius: '8px' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleUnlock} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <input
                type="password"
                required
                autoFocus
                className="input-field"
                placeholder="Enter Access Password"
                value={inputPassword}
                onChange={e => setInputPassword(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
                <button type="button" onClick={() => setUnlockModal(null)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Unlock Stream <ExternalLink size={14} />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </main>
    </DashboardLayout>
  );
}
