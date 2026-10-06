import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { 
  Bell, Check, Trash2, X, AlertTriangle, CheckCircle2, 
  XCircle, Zap, Info, Clock, Volume2, VolumeX, Eye, 
  RefreshCw, Send, ShieldAlert, Sparkles, ChevronRight
} from 'lucide-react';
import { playDingSound } from '../lib/soundEffects';
import { checkAndTriggerDailyTargetReminders } from '../lib/notificationService';

export default function NotificationBar() {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [toastNotification, setToastNotification] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'unread'
  const [selectedNotification, setSelectedNotification] = useState(null); // Detail Modal
  const [isSyncing, setIsSyncing] = useState(false);
  const drawerRef = useRef(null);

  // Load notifications from database
  const loadNotifications = async () => {
    if (!profile) return;
    try {
      const { data, error } = await supabase
        .from('user_notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!error && data) {
        setNotifications(data);
      }
    } catch (err) {
      console.warn('[NotificationBar] Could not query user_notifications:', err);
    }
  };

  useEffect(() => {
    if (!profile) return;
    loadNotifications();

    // Check & trigger daily target reminders for worker
    checkAndTriggerDailyTargetReminders(profile);

    // Periodic check every 10 minutes
    const interval = setInterval(() => {
      checkAndTriggerDailyTargetReminders(profile);
    }, 600000);

    // Realtime channel for incoming notifications
    const channel = supabase
      .channel(`user-notifs-${profile.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'user_notifications',
        filter: `user_id=eq.${profile.id}`,
      }, (payload) => {
        const newNotif = payload.new;
        setNotifications(prev => [newNotif, ...prev.filter(n => n.id !== newNotif.id)]);

        // Play Facebook ding chime
        if (soundEnabled) {
          playDingSound();
        }

        // Display floating toast alert with option to click and view
        setToastNotification(newNotif);
        setTimeout(() => {
          setToastNotification(prev => (prev?.id === newNotif.id ? null : prev));
        }, 8000);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [profile, soundEnabled]);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const markAllAsRead = async () => {
    if (!profile) return;
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    try {
      await supabase
        .from('user_notifications')
        .update({ is_read: true })
        .eq('user_id', profile.id)
        .eq('is_read', false);
    } catch (err) {
      console.warn('Error marking read:', err);
    }
  };

  const markSingleAsRead = async (id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    try {
      await supabase.from('user_notifications').update({ is_read: true }).eq('id', id);
    } catch (_) {}
  };

  const deleteNotification = async (id, e) => {
    if (e) e.stopPropagation();
    setNotifications(prev => prev.filter(n => n.id !== id));
    if (selectedNotification?.id === id) setSelectedNotification(null);
    try {
      await supabase.from('user_notifications').delete().eq('id', id);
    } catch (_) {}
  };

  const handleOpenDetail = (notif) => {
    setSelectedNotification(notif);
    if (!notif.is_read) {
      markSingleAsRead(notif.id);
    }
  };

  const handleManualSyncReminder = async () => {
    if (!profile) return;
    setIsSyncing(true);
    try {
      // Clear today's reminder key to force immediate status evaluation
      const todayDate = new Date().toISOString().split('T')[0];
      const keys = Object.keys(localStorage).filter(k => k.startsWith(`diamt_daily_reminder_${profile.id}_${todayDate}`));
      keys.forEach(k => localStorage.removeItem(k));
      await checkAndTriggerDailyTargetReminders(profile);
      await loadNotifications();
      playDingSound();
    } catch (err) {
      console.error('Error syncing status reminder:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const getNotifIcon = (type, size = 18) => {
    switch (type) {
      case 'claim_approved':
        return <CheckCircle2 size={size} color="#10b981" />;
      case 'claim_rejected':
        return <XCircle size={size} color="#ef4444" />;
      case 'claim_issued':
        return <Zap size={size} color="#10b981" />;
      case 'target_warning':
        return <AlertTriangle size={size} color="#ef4444" />;
      case 'target_reminder':
        return <Clock size={size} color="#f59e0b" />;
      case 'admin_message':
        return <ShieldAlert size={size} color="#3b82f6" />;
      default:
        return <Info size={size} color="#3b82f6" />;
    }
  };

  const getNotifBadge = (type) => {
    switch (type) {
      case 'claim_approved':
        return { label: 'Claim Approved', bg: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: 'rgba(16, 185, 129, 0.3)' };
      case 'claim_rejected':
        return { label: 'Claim Rejected', bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: 'rgba(239, 68, 68, 0.3)' };
      case 'claim_issued':
        return { label: 'Seed Claim Issued', bg: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: 'rgba(16, 185, 129, 0.3)' };
      case 'target_warning':
        return { label: 'Target Warning', bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: 'rgba(239, 68, 68, 0.3)' };
      case 'target_reminder':
        return { label: 'Target Reminder', bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: 'rgba(245, 158, 11, 0.3)' };
      case 'admin_message':
        return { label: 'Admin Notice', bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', border: 'rgba(59, 130, 246, 0.3)' };
      default:
        return { label: 'Notification', bg: 'rgba(59, 130, 246, 0.12)', color: '#3b82f6', border: 'rgba(59, 130, 246, 0.25)' };
    }
  };

  const filteredNotifs = activeTab === 'unread' 
    ? notifications.filter(n => !n.is_read) 
    : notifications;

  return (
    <>
      {/* ── Bell Icon Button (Inside Navbar) ── */}
      <div style={{ position: 'relative' }}>
        <button
          id="notif-bell-btn"
          onClick={() => {
            setIsOpen(prev => !prev);
            if (!isOpen) loadNotifications();
          }}
          className="btn btn-secondary"
          style={{
            position: 'relative',
            padding: '8px',
            borderRadius: '50%',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isOpen ? 'rgba(16, 185, 129, 0.15)' : undefined,
            borderColor: isOpen ? '#10b981' : undefined
          }}
          title="Notifications & Audits"
          aria-label="Open notifications"
        >
          <Bell size={18} color={unreadCount > 0 ? '#10b981' : 'currentColor'} />
          {unreadCount > 0 && (
            <span style={{
              position: 'absolute',
              top: '-3px',
              right: '-3px',
              background: '#ef4444',
              color: '#ffffff',
              fontSize: '10px',
              fontWeight: 800,
              minWidth: '18px',
              height: '18px',
              borderRadius: '9px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
              boxShadow: '0 2px 8px rgba(239, 68, 68, 0.5)',
              animation: 'notifPulse 2s infinite'
            }}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* ── Floating Incoming Toast Alert (Rendered in Portal) ── */}
      {toastNotification && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed',
          top: '76px',
          right: '20px',
          zIndex: 100000,
          maxWidth: '400px',
          width: 'calc(100% - 40px)',
          background: '#0f172a',
          border: '1px solid #10b981',
          borderRadius: '16px',
          padding: '16px 18px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
          display: 'flex',
          gap: '14px',
          alignItems: 'flex-start',
          animation: 'slideInRight 0.35s ease-out'
        }}>
          <div style={{ marginTop: '2px', flexShrink: 0 }}>
            {getNotifIcon(toastNotification.type, 22)}
          </div>
          <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => handleOpenDetail(toastNotification)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span style={{
                fontSize: '10px',
                fontWeight: 800,
                padding: '2px 8px',
                borderRadius: '6px',
                textTransform: 'uppercase',
                ...getNotifBadge(toastNotification.type)
              }}>
                {getNotifBadge(toastNotification.type).label}
              </span>
              <span style={{ fontSize: '10px', color: '#10b981', fontWeight: 700 }}>
                • Ding Chime
              </span>
            </div>
            <div style={{ fontSize: '14px', fontWeight: 800, color: '#f8fafc', lineHeight: '1.3' }}>
              {toastNotification.title}
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '5px', lineHeight: '1.45', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {toastNotification.message}
            </div>
            <div style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 700, marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              Click to open & view full notice <ChevronRight size={13} />
            </div>
          </div>
          <button 
            onClick={() => setToastNotification(null)}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px' }}
            title="Dismiss popup"
          >
            <X size={16} />
          </button>
        </div>,
        document.body
      )}

      {/* ── Slide-Out Notification Drawer (Rendered via React Portal directly into body) ── */}
      {isOpen && typeof document !== 'undefined' && createPortal(
        <>
          {/* Backdrop Overlay */}
          <div 
            onClick={() => setIsOpen(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.55)',
              backdropFilter: 'blur(3px)',
              zIndex: 99990,
              animation: 'fadeIn 0.2s ease-out'
            }}
          />

          {/* Drawer Container */}
          <div 
            ref={drawerRef}
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              width: '100%',
              maxWidth: '460px',
              background: '#0b1120',
              borderLeft: '1px solid rgba(56, 189, 248, 0.2)',
              boxShadow: '-12px 0 40px rgba(0,0,0,0.6)',
              zIndex: 99999,
              display: 'flex',
              flexDirection: 'column',
              animation: 'slideInRight 0.25s ease-out'
            }}
          >
            {/* Header */}
            <div style={{
              padding: '18px 22px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              background: '#0f172a',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexShrink: 0
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: 'rgba(16, 185, 129, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid rgba(16, 185, 129, 0.3)'
                }}>
                  <Bell size={20} color="#10b981" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#f8fafc' }}>
                    Notifications & Audits
                  </h3>
                  <span style={{ fontSize: '11px', color: unreadCount > 0 ? '#38bdf8' : '#94a3b8', fontWeight: 600 }}>
                    {unreadCount} unread alert{unreadCount !== 1 ? 's' : ''} • Realtime listening
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {/* Facebook Chime Test & Sound toggle */}
                <button
                  onClick={() => {
                    playDingSound();
                    if (!soundEnabled) setSoundEnabled(true);
                  }}
                  title="Test Facebook Ding Chime"
                  style={{
                    background: 'rgba(56, 189, 248, 0.1)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    color: '#38bdf8',
                    padding: '6px 10px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px'
                  }}
                >
                  <Volume2 size={13} /> Chime
                </button>

                <button
                  onClick={() => setIsOpen(false)}
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: '6px',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                  title="Close drawer"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Sub-Header Toolbar (Tabs + Mark Read + Refresh) */}
            <div style={{
              padding: '10px 20px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
              background: 'rgba(15, 23, 42, 0.7)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexShrink: 0
            }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={() => setActiveTab('all')}
                  style={{
                    background: activeTab === 'all' ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
                    color: activeTab === 'all' ? '#10b981' : '#94a3b8',
                    border: activeTab === 'all' ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid transparent',
                    padding: '5px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  All ({notifications.length})
                </button>
                <button
                  onClick={() => setActiveTab('unread')}
                  style={{
                    background: activeTab === 'unread' ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
                    color: activeTab === 'unread' ? '#10b981' : '#94a3b8',
                    border: activeTab === 'unread' ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid transparent',
                    padding: '5px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Unread ({unreadCount})
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    style={{
                      background: 'none',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: '#94a3b8',
                      padding: '5px 10px',
                      borderRadius: '8px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                    title="Mark all as read"
                  >
                    <Check size={12} /> Mark All Read
                  </button>
                )}

                <button
                  onClick={handleManualSyncReminder}
                  disabled={isSyncing}
                  style={{
                    background: 'none',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: '#94a3b8',
                    padding: '5px 8px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                  title="Check & sync latest target compliance status"
                >
                  <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* Scrollable Notifications List */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}>
              {filteredNotifs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
                  <div style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px dashed rgba(255,255,255,0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px'
                  }}>
                    <Bell size={28} color="#64748b" />
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: '#f8fafc' }}>
                    {activeTab === 'unread' ? 'No unread alerts' : 'No notifications yet'}
                  </div>
                  <p style={{ fontSize: '12px', margin: '6px 0 16px', lineHeight: '1.5', maxWidth: '300px', marginLeft: 'auto', marginRight: 'auto' }}>
                    {activeTab === 'unread'
                      ? 'You are all caught up! Switch to "All" to review past claims and compliance history.'
                      : 'Realtime updates on claims, 4x daily target status alerts, and administrator notices will appear here automatically.'}
                  </p>
                  <button
                    onClick={handleManualSyncReminder}
                    disabled={isSyncing}
                    className="btn btn-secondary"
                    style={{ fontSize: '12px', padding: '7px 14px', margin: '0 auto' }}
                  >
                    <RefreshCw size={13} /> {isSyncing ? 'Syncing...' : 'Check Compliance Status Now'}
                  </button>
                </div>
              ) : (
                filteredNotifs.map((notif) => {
                  const badge = getNotifBadge(notif.type);
                  return (
                    <div
                      key={notif.id}
                      onClick={() => handleOpenDetail(notif)}
                      style={{
                        background: notif.is_read ? 'rgba(15, 23, 42, 0.5)' : 'rgba(16, 185, 129, 0.08)',
                        border: notif.is_read ? '1px solid rgba(255, 255, 255, 0.07)' : '1px solid rgba(16, 185, 129, 0.35)',
                        borderRadius: '14px',
                        padding: '16px',
                        display: 'flex',
                        gap: '12px',
                        alignItems: 'flex-start',
                        cursor: 'pointer',
                        position: 'relative',
                        transition: 'all 0.18s ease'
                      }}
                    >
                      {/* Icon */}
                      <div style={{ marginTop: '2px', flexShrink: 0 }}>
                        {getNotifIcon(notif.type, 20)}
                      </div>

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{
                            fontSize: '10px',
                            fontWeight: 800,
                            padding: '2px 8px',
                            borderRadius: '5px',
                            textTransform: 'uppercase',
                            background: badge.bg,
                            color: badge.color,
                            border: `1px solid ${badge.border}`
                          }}>
                            {badge.label}
                          </span>
                          {!notif.is_read && (
                            <span style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              background: '#10b981',
                              boxShadow: '0 0 8px #10b981',
                              flexShrink: 0
                            }} />
                          )}
                        </div>

                        <div style={{
                          fontSize: '13.5px',
                          fontWeight: notif.is_read ? 700 : 800,
                          color: '#f8fafc',
                          lineHeight: '1.3'
                        }}>
                          {notif.title}
                        </div>

                        <p style={{
                          margin: '6px 0 0',
                          fontSize: '12px',
                          color: '#94a3b8',
                          lineHeight: '1.45',
                          wordBreak: 'break-word',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden'
                        }}>
                          {notif.message}
                        </p>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px' }}>
                          <span style={{ fontSize: '11px', color: '#64748b' }}>
                            {new Date(notif.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(notif.created_at).toLocaleDateString()}
                          </span>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 700, display: 'flex', alignItems: 'center' }}>
                              Open <ChevronRight size={12} />
                            </span>
                            <button
                              onClick={(e) => deleteNotification(notif.id, e)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#64748b',
                                cursor: 'pointer',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                borderRadius: '4px'
                              }}
                              title="Delete notification"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer Target Notice */}
            <div style={{
              padding: '14px 20px',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              background: '#0f172a',
              fontSize: '11px',
              color: '#94a3b8',
              lineHeight: '1.45',
              flexShrink: 0
            }}>
              <b style={{ color: '#10b981' }}>Mandatory Compliance Rule:</b> 4 daily performance reviews are automatically dispatched to keep workers aligned. Failing the weekly $40 rule results in system auto-suspension and station exit before tomorrow at 8:00 AM.
            </div>
          </div>
        </>,
        document.body
      )}

      {/* ── Notification Detail Modal ("Open Any Notification") ── */}
      {selectedNotification && typeof document !== 'undefined' && createPortal(
        <div style={{
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
          zIndex: 100010,
          padding: '20px',
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{
            background: '#0f172a',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            borderRadius: '20px',
            maxWidth: '560px',
            width: '100%',
            boxShadow: '0 25px 60px rgba(0, 0, 0, 0.7)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(30, 41, 59, 0.5)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: '14px'
            }}>
              <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                <div style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '12px',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  {getNotifIcon(selectedNotification.type, 22)}
                </div>
                <div>
                  <span style={{
                    fontSize: '10px',
                    fontWeight: 800,
                    padding: '3px 9px',
                    borderRadius: '6px',
                    textTransform: 'uppercase',
                    display: 'inline-block',
                    marginBottom: '6px',
                    ...getNotifBadge(selectedNotification.type)
                  }}>
                    {getNotifBadge(selectedNotification.type).label}
                  </span>
                  <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#f8fafc', lineHeight: '1.3' }}>
                    {selectedNotification.title}
                  </h3>
                </div>
              </div>

              <button
                onClick={() => setSelectedNotification(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
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
                <label style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '8px' }}>
                  Full Message Details
                </label>
                <div style={{
                  background: 'rgba(15, 23, 42, 0.7)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '12px',
                  padding: '16px',
                  fontSize: '13.5px',
                  color: '#e2e8f0',
                  lineHeight: '1.6',
                  whiteSpace: 'pre-wrap'
                }}>
                  {selectedNotification.message}
                </div>
              </div>

              {/* Metadata badge details if available */}
              {selectedNotification.metadata && Object.keys(selectedNotification.metadata).length > 0 && (
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '10px',
                  padding: '12px 14px',
                  background: 'rgba(56, 189, 248, 0.05)',
                  border: '1px solid rgba(56, 189, 248, 0.15)',
                  borderRadius: '10px',
                  fontSize: '12px'
                }}>
                  {selectedNotification.metadata.weekIdentifier && (
                    <span><strong>Week:</strong> {selectedNotification.metadata.weekIdentifier}</span>
                  )}
                  {selectedNotification.metadata.dayOrWeek && (
                    <span><strong>Day:</strong> {selectedNotification.metadata.dayOrWeek}</span>
                  )}
                  {selectedNotification.metadata.amount && (
                    <span><strong>Amount:</strong> ${parseFloat(selectedNotification.metadata.amount).toFixed(2)} USD</span>
                  )}
                  {selectedNotification.metadata.slot && (
                    <span><strong>Audit Slot:</strong> {selectedNotification.metadata.slot}</span>
                  )}
                </div>
              )}

              {/* Mandatory Policy Warning Callout */}
              <div style={{
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: '12px',
                padding: '14px',
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start'
              }}>
                <AlertTriangle size={18} color="#ef4444" style={{ marginTop: '2px', flexShrink: 0 }} />
                <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: '1.45' }}>
                  <strong style={{ color: '#ef4444' }}>Consequence of Non-Compliance:</strong> Every worker is required to submit approved claims totaling at least $40.00 each week. Failure to comply triggers irrevocable system auto-suspension and mandatory departure from the station before tomorrow at 8:00 AM.
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: '#64748b' }}>
                <span>Dispatched: {new Date(selectedNotification.created_at).toLocaleString()}</span>
                <span>User: {selectedNotification.user_email}</span>
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '16px 24px',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(30, 41, 59, 0.5)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <button
                onClick={(e) => deleteNotification(selectedNotification.id, e)}
                style={{
                  background: 'none',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#ef4444',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <Trash2 size={13} /> Delete Notice
              </button>

              <button
                onClick={() => setSelectedNotification(null)}
                className="btn btn-primary"
                style={{
                  padding: '9px 20px',
                  fontSize: '13px',
                  fontWeight: 700
                }}
              >
                Close Notice
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Global CSS for Animations */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes notifPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.85; transform: scale(1.1); }
        }
      `}</style>
    </>
  );
}
