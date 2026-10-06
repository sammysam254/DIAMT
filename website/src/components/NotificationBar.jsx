import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { 
  Bell, Check, Trash2, X, AlertTriangle, CheckCircle2, 
  XCircle, Zap, Info, Clock, Volume2, VolumeX 
} from 'lucide-react';
import { playDingSound } from '../lib/soundEffects';
import { checkAndTriggerDailyTargetReminders } from '../lib/notificationService';

export default function NotificationBar() {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [toastNotification, setToastNotification] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const drawerRef = useRef(null);

  // Load existing notifications
  const loadNotifications = async () => {
    if (!profile) return;
    try {
      const { data, error } = await supabase
        .from('user_notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(30);

      if (!error && data) {
        setNotifications(data);
      }
    } catch (err) {
      console.warn('Could not query notifications:', err);
    }
  };

  useEffect(() => {
    if (!profile) return;
    loadNotifications();

    // Check & trigger daily 4x target reminders for worker
    checkAndTriggerDailyTargetReminders(profile);

    // Periodic check every 10 minutes
    const interval = setInterval(() => {
      checkAndTriggerDailyTargetReminders(profile);
    }, 600000);

    // Realtime subscription for incoming notifications
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

        // Show floating toast alert
        setToastNotification(newNotif);
        setTimeout(() => {
          setToastNotification(null);
        }, 6000);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [profile, soundEnabled]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target) && !e.target.closest('#notif-bell-btn')) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

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

  const deleteNotification = async (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    try {
      await supabase.from('user_notifications').delete().eq('id', id);
    } catch (_) {}
  };

  const getNotifIcon = (type) => {
    switch (type) {
      case 'claim_approved':
        return <CheckCircle2 size={18} color="#059669" />;
      case 'claim_rejected':
        return <XCircle size={18} color="#ef4444" />;
      case 'claim_issued':
        return <Zap size={18} color="#10b981" />;
      case 'target_warning':
        return <AlertTriangle size={18} color="#ef4444" />;
      case 'target_reminder':
        return <Clock size={18} color="#d97706" />;
      default:
        return <Info size={18} color="var(--primary, #3b82f6)" />;
    }
  };

  return (
    <>
      {/* Bell Button */}
      <div style={{ position: 'relative' }}>
        <button
          id="notif-bell-btn"
          onClick={() => setIsOpen(prev => !prev)}
          className="btn btn-secondary"
          style={{
            position: 'relative',
            padding: '8px',
            borderRadius: '50%',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title="Notifications & Alerts"
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
              minWidth: '17px',
              height: '17px',
              borderRadius: '9px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
              boxShadow: '0 2px 6px rgba(239, 68, 68, 0.4)',
              animation: 'pulse 2s infinite'
            }}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Floating Incoming Toast Alert (with Ding sound) */}
      {toastNotification && (
        <div style={{
          position: 'fixed',
          top: '76px',
          right: '20px',
          zIndex: 9999,
          maxWidth: '380px',
          width: '90%',
          background: 'var(--bg-card, #1e293b)',
          border: '1px solid #10b981',
          borderRadius: '16px',
          padding: '16px',
          boxShadow: '0 12px 30px rgba(0,0,0,0.3)',
          display: 'flex',
          gap: '12px',
          alignItems: 'flex-start',
          animation: 'slideInRight 0.35s ease-out'
        }}>
          <div style={{ marginTop: '2px' }}>
            {getNotifIcon(toastNotification.type)}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-main, #f8fafc)', lineHeight: '1.3' }}>
              {toastNotification.title}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted, #94a3b8)', marginTop: '4px', lineHeight: '1.4' }}>
              {toastNotification.message}
            </div>
            <div style={{ fontSize: '10px', color: '#10b981', fontWeight: 700, marginTop: '6px' }}>
              Just now • Ding chime played
            </div>
          </div>
          <button 
            onClick={() => setToastNotification(null)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Slide-Out Notification Drawer / Bar */}
      {isOpen && (
        <div 
          ref={drawerRef}
          style={{
            position: 'fixed',
            top: '64px',
            right: 0,
            bottom: 0,
            width: '100%',
            maxWidth: '420px',
            background: 'var(--bg-sidebar, #0f172a)',
            borderLeft: '1px solid var(--border-color, #1e293b)',
            boxShadow: '-8px 0 30px rgba(0,0,0,0.3)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            animation: 'slideInRight 0.25s ease-out'
          }}
        >
          {/* Header */}
          <div style={{
            padding: '18px 20px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--bg-main)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Bell size={20} color="#10b981" />
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: 'var(--text-main)' }}>
                  Notifications & Audits
                </h3>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {unreadCount} unread alert{unreadCount !== 1 ? 's' : ''}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={() => setSoundEnabled(prev => !prev)}
                title={soundEnabled ? 'Ding sound enabled' : 'Sound muted'}
                style={{
                  background: 'none',
                  border: '1px solid var(--border-color)',
                  color: soundEnabled ? '#10b981' : 'var(--text-muted)',
                  padding: '5px 8px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
              </button>

              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-muted)',
                    padding: '5px 10px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Check size={12} /> Mark Read
                </button>
              )}

              <button
                onClick={() => setIsOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* List of Notifications */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px' }}>
            {notifications.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
                <Bell size={36} color="var(--border-color)" style={{ margin: '0 auto 12px' }} />
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-main)' }}>No notifications yet</div>
                <p style={{ fontSize: '12px', margin: '4px 0 0' }}>
                  Realtime updates on claims, 4x daily target reminders, and administrator notices will appear here.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {notifications.map((notif) => (
                  <div
                    key={notif.id}
                    onClick={() => !notif.is_read && markSingleAsRead(notif.id)}
                    style={{
                      background: notif.is_read ? 'var(--bg-main)' : 'rgba(5, 150, 105, 0.08)',
                      border: notif.is_read ? '1px solid var(--border-color)' : '1px solid rgba(5, 150, 105, 0.3)',
                      borderRadius: '12px',
                      padding: '14px',
                      display: 'flex',
                      gap: '12px',
                      alignItems: 'flex-start',
                      cursor: 'pointer',
                      position: 'relative',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div style={{ marginTop: '2px', flexShrink: 0 }}>
                      {getNotifIcon(notif.type)}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '13px', fontWeight: notif.is_read ? 700 : 800, color: 'var(--text-main)' }}>
                          {notif.title}
                        </span>
                        {!notif.is_read && (
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />
                        )}
                      </div>

                      <p style={{
                        margin: '4px 0 0',
                        fontSize: '12px',
                        color: 'var(--text-muted)',
                        lineHeight: '1.45',
                        wordBreak: 'break-word'
                      }}>
                        {notif.message}
                      </p>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}>
                          {new Date(notif.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(notif.created_at).toLocaleDateString()}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteNotification(notif.id);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-dim)',
                            cursor: 'pointer',
                            padding: '2px',
                            display: 'flex',
                            alignItems: 'center'
                          }}
                          title="Dismiss notification"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer Target Notice */}
          <div style={{
            padding: '14px 18px',
            borderTop: '1px solid var(--border-color)',
            background: 'var(--bg-main)',
            fontSize: '11px',
            color: 'var(--text-muted)',
            lineHeight: '1.4'
          }}>
            <b style={{ color: '#10b981' }}>Compliance Policy:</b> 4 daily performance reviews are automatically dispatched to keep workers aligned with their active weekly targets.
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.1); }
        }
      `}</style>
    </>
  );
}
