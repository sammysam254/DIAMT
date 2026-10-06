import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import DashboardLayout from '../layouts/DashboardLayout';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { 
  Smartphone, Lock, Unlock, ExternalLink, RefreshCw, Eye, EyeOff, 
  AlertCircle, DollarSign, Award, AlertTriangle, CheckCircle2, ChevronRight,
  Bell, Volume2, ShieldAlert, Check, Trash2, X, Clock, Zap, XCircle, Info
} from 'lucide-react';
import SEO from '../components/SEO';
import DiamtLoader from '../components/DiamtLoader';
import { getISOWeekString } from '../lib/weekUtils';
import { playDingSound } from '../lib/soundEffects';

export default function WorkerDashboard() {
  const { profile } = useAuth();
  const [assignments, setAssignments] = useState([]);
  const [weekClaims, setWeekClaims] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [selectedNotifModal, setSelectedNotifModal] = useState(null);
  const [notifFilter, setNotifFilter] = useState('all'); // 'all' | 'unread' | 'urgent'
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

      // Load worker's in-app notifications
      const { data: nData } = await supabase
        .from('user_notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(40);
      setNotifications(nData || []);
    } catch (e) {
      console.error('Error loading worker assignments and notifications:', e);
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
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'user_notifications',
        filter: `user_id=eq.${profile.id}`,
      }, (payload) => {
        setNotifications(prev => [payload.new, ...prev.filter(n => n.id !== payload.new.id)]);
        playDingSound();
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'user_notifications',
        filter: `user_id=eq.${profile.id}`,
      }, (payload) => {
        setNotifications(prev => prev.map(n => n.id === payload.new.id ? payload.new : n));
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'user_notifications',
      }, (payload) => {
        setNotifications(prev => prev.filter(n => n.id !== payload.old.id));
      })
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

  const handleMarkAllNotifsRead = async () => {
    if (!profile) return;
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    try {
      await supabase
        .from('user_notifications')
        .update({ is_read: true })
        .eq('user_id', profile.id)
        .eq('is_read', false);
    } catch (_) {}
  };

  const handleMarkSingleNotifRead = async (id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    try {
      await supabase.from('user_notifications').update({ is_read: true }).eq('id', id);
    } catch (_) {}
  };

  const handleDeleteNotif = async (id, e) => {
    if (e) e.stopPropagation();
    setNotifications(prev => prev.filter(n => n.id !== id));
    if (selectedNotifModal?.id === id) setSelectedNotifModal(null);
    try {
      await supabase.from('user_notifications').delete().eq('id', id);
    } catch (_) {}
  };

  const handleOpenNotifModal = (notif) => {
    setSelectedNotifModal(notif);
    if (!notif.is_read) {
      handleMarkSingleNotifRead(notif.id);
    }
  };

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

      {/* ── Prominent In-App Notifications & Performance Audits Section ── */}
      <section className="card" style={{
        marginBottom: '28px',
        padding: '24px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: '18px',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.25)'
      }}>
        {/* Section Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '14px',
          marginBottom: '18px',
          paddingBottom: '14px',
          borderBottom: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Bell size={22} color="var(--primary)" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                  In-App Notifications & Status Audits
                </h2>
                {notifications.filter(n => !n.is_read).length > 0 && (
                  <span style={{
                    background: '#ef4444',
                    color: '#ffffff',
                    fontSize: '11px',
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: '999px',
                    boxShadow: '0 2px 6px rgba(239, 68, 68, 0.4)'
                  }}>
                    {notifications.filter(n => !n.is_read).length} UNREAD
                  </span>
                )}
              </div>
              <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                Realtime target checks, 4x daily audit briefings, claim approvals, and admin notices.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {/* Filter Pills */}
            <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-main)', padding: '4px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
              <button
                onClick={() => setNotifFilter('all')}
                style={{
                  background: notifFilter === 'all' ? 'var(--primary)' : 'transparent',
                  color: notifFilter === 'all' ? '#ffffff' : 'var(--text-muted)',
                  border: 'none',
                  padding: '5px 12px',
                  borderRadius: '7px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                All ({notifications.length})
              </button>
              <button
                onClick={() => setNotifFilter('unread')}
                style={{
                  background: notifFilter === 'unread' ? '#10b981' : 'transparent',
                  color: notifFilter === 'unread' ? '#ffffff' : 'var(--text-muted)',
                  border: 'none',
                  padding: '5px 12px',
                  borderRadius: '7px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Unread ({notifications.filter(n => !n.is_read).length})
              </button>
              <button
                onClick={() => setNotifFilter('urgent')}
                style={{
                  background: notifFilter === 'urgent' ? '#ef4444' : 'transparent',
                  color: notifFilter === 'urgent' ? '#ffffff' : 'var(--text-muted)',
                  border: 'none',
                  padding: '5px 12px',
                  borderRadius: '7px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Urgent ({notifications.filter(n => n.type === 'target_warning').length})
              </button>
            </div>

            {/* Test Facebook Ding Chime */}
            <button
              onClick={() => playDingSound()}
              title="Test the Facebook ding sound effect"
              className="btn btn-secondary"
              style={{ padding: '6px 12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '5px' }}
            >
              <Volume2 size={13} color="#10b981" /> Test Chime
            </button>

            {notifications.filter(n => !n.is_read).length > 0 && (
              <button
                onClick={handleMarkAllNotifsRead}
                className="btn btn-secondary"
                style={{ padding: '6px 12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '5px' }}
              >
                <Check size={13} /> Mark All Read
              </button>
            )}
          </div>
        </div>

        {/* Notifications List */}
        {(() => {
          const filtered = notifications.filter(n => {
            if (notifFilter === 'unread') return !n.is_read;
            if (notifFilter === 'urgent') return n.type === 'target_warning';
            return true;
          });

          if (filtered.length === 0) {
            return (
              <div style={{
                textAlign: 'center',
                padding: '36px 20px',
                background: 'rgba(255, 255, 255, 0.02)',
                borderRadius: '12px',
                border: '1px dashed var(--border-color)',
                color: 'var(--text-muted)'
              }}>
                <CheckCircle2 size={32} color="#10b981" style={{ margin: '0 auto 10px' }} />
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-main)' }}>
                  {notifFilter === 'unread' ? 'All Alerts Have Been Read' : 'No Activity Alerts Recorded Yet'}
                </div>
                <p style={{ fontSize: '12px', margin: '4px 0 0' }}>
                  {notifFilter === 'unread'
                    ? 'Switch filter to "All" to view past notices and compliance milestones.'
                    : 'System 4x daily audit notifications and claim status updates will appear here automatically.'}
                </p>
              </div>
            );
          }

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {filtered.map(notif => {
                const isUrgent = notif.type === 'target_warning';
                const isApproved = notif.type === 'claim_approved' || notif.type === 'claim_issued';
                const isUnread = !notif.is_read;

                return (
                  <div
                    key={notif.id}
                    onClick={() => handleOpenNotifModal(notif)}
                    style={{
                      background: isUnread 
                        ? (isUrgent ? 'rgba(239, 68, 68, 0.08)' : 'rgba(56, 189, 248, 0.08)')
                        : 'rgba(255, 255, 255, 0.02)',
                      border: isUnread 
                        ? (isUrgent ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(56, 189, 248, 0.35)')
                        : '1px solid var(--border-color)',
                      borderRadius: '14px',
                      padding: '16px 20px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '14px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      position: 'relative'
                    }}
                  >
                    {/* Category Icon */}
                    <div style={{ marginTop: '2px', flexShrink: 0 }}>
                      {isUrgent ? (
                        <AlertTriangle size={22} color="#ef4444" />
                      ) : isApproved ? (
                        <CheckCircle2 size={22} color="#10b981" />
                      ) : notif.type === 'claim_rejected' ? (
                        <XCircle size={22} color="#ef4444" />
                      ) : (
                        <Clock size={22} color="#f59e0b" />
                      )}
                    </div>

                    {/* Notice Main Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{
                            fontSize: '10px',
                            fontWeight: 800,
                            padding: '3px 8px',
                            borderRadius: '5px',
                            textTransform: 'uppercase',
                            background: isUrgent ? 'rgba(239, 68, 68, 0.2)' : isApproved ? 'rgba(16, 185, 129, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                            color: isUrgent ? '#ef4444' : isApproved ? '#10b981' : 'var(--primary)',
                            border: `1px solid ${isUrgent ? 'rgba(239, 68, 68, 0.4)' : isApproved ? 'rgba(16, 185, 129, 0.4)' : 'rgba(56, 189, 248, 0.4)'}`
                          }}>
                            {isUrgent ? 'TARGET WARNING' : isApproved ? 'CLAIM CONFIRMED' : 'AUDIT BRIEF'}
                          </span>
                          {isUnread && (
                            <span style={{
                              background: '#10b981',
                              color: '#ffffff',
                              fontSize: '9px',
                              fontWeight: 900,
                              padding: '2px 6px',
                              borderRadius: '4px'
                            }}>
                              NEW
                            </span>
                          )}
                        </div>

                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {new Date(notif.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(notif.created_at).toLocaleDateString()}
                        </span>
                      </div>

                      <h3 style={{
                        fontSize: '15px',
                        fontWeight: 800,
                        margin: '0 0 6px 0',
                        color: isUrgent ? '#ef4444' : 'var(--text-main)',
                        lineHeight: '1.3'
                      }}>
                        {notif.title}
                      </h3>

                      <p style={{
                        margin: 0,
                        fontSize: '13px',
                        color: 'var(--text-muted)',
                        lineHeight: '1.5',
                        whiteSpace: 'pre-line'
                      }}>
                        {notif.message}
                      </p>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', flexWrap: 'wrap', gap: '8px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--primary)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          Click to open notice details <ChevronRight size={13} />
                        </span>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {isUnread && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMarkSingleNotifRead(notif.id);
                              }}
                              className="btn btn-secondary"
                              style={{ padding: '4px 10px', fontSize: '11px' }}
                            >
                              <Check size={12} /> Mark Read
                            </button>
                          )}
                          <button
                            onClick={(e) => handleDeleteNotif(notif.id, e)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              padding: '4px',
                              display: 'flex',
                              alignItems: 'center'
                            }}
                            title="Delete this notice"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </section>

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

      {/* ── Notification Detail Modal ("Open Any Notification") ── */}
      {selectedNotifModal && (
        <div 
          className="modal-overlay" 
          onClick={() => setSelectedNotifModal(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(5px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100020,
            padding: '20px'
          }}
        >
          <div 
            style={{
              background: 'var(--bg-card, #0f172a)',
              border: '1px solid var(--border-color)',
              borderRadius: '20px',
              maxWidth: '560px',
              width: '100%',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.8)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid var(--border-color)',
              background: 'rgba(30, 41, 59, 0.5)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: '14px'
            }}>
              <div>
                <span style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  padding: '3px 9px',
                  borderRadius: '6px',
                  textTransform: 'uppercase',
                  display: 'inline-block',
                  marginBottom: '6px',
                  background: selectedNotifModal.type === 'target_warning' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                  color: selectedNotifModal.type === 'target_warning' ? '#ef4444' : '#10b981',
                  border: `1px solid ${selectedNotifModal.type === 'target_warning' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`
                }}>
                  {selectedNotifModal.type === 'target_warning' ? 'URGENT TARGET WARNING' : 'COMPLIANCE AUDIT'}
                </span>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text-main)', lineHeight: '1.3' }}>
                  {selectedNotifModal.title}
                </h3>
              </div>

              <button
                onClick={() => setSelectedNotifModal(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex'
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
                  Full Message Details
                </label>
                <div style={{
                  background: 'var(--bg-main)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '12px',
                  padding: '16px',
                  fontSize: '13.5px',
                  color: 'var(--text-main)',
                  lineHeight: '1.6',
                  whiteSpace: 'pre-wrap'
                }}>
                  {selectedNotifModal.message}
                </div>
              </div>

              {/* Consequence Alert Box */}
              <div style={{
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '12px',
                padding: '14px',
                display: 'flex',
                gap: '12px',
                alignItems: 'flex-start'
              }}>
                <AlertTriangle size={18} color="#ef4444" style={{ marginTop: '2px', flexShrink: 0 }} />
                <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: '1.45' }}>
                  <strong style={{ color: '#ef4444' }}>Mandatory Rule & Consequence:</strong> Workers must achieve at least $40.00 in approved claims each week. Failure results in immediate system auto-suspension and mandatory departure from the station before tomorrow at 8:00 AM.
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-dim)' }}>
                <span>Dispatched: {new Date(selectedNotifModal.created_at).toLocaleString()}</span>
                <span>User: {selectedNotifModal.user_email}</span>
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '16px 24px',
              borderTop: '1px solid var(--border-color)',
              background: 'rgba(30, 41, 59, 0.5)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <Link
                to="/worker/claims"
                className="btn btn-secondary"
                style={{ fontSize: '12px', padding: '8px 14px' }}
                onClick={() => setSelectedNotifModal(null)}
              >
                Go to Claims Page
              </Link>

              <button
                onClick={() => setSelectedNotifModal(null)}
                className="btn btn-primary"
                style={{ padding: '8px 20px', fontSize: '13px', fontWeight: 700 }}
              >
                Close Notice
              </button>
            </div>
          </div>
        </div>
      )}
      </main>
    </DashboardLayout>
  );
}
