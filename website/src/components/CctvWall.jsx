import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Video, Shield, Maximize2, RefreshCw, X, ArrowLeft, Eye, Play, Trash2, ExternalLink, AlertTriangle, ShieldCheck } from 'lucide-react';

export default function CctvWall({ currentUser, isSuperAdmin, isSeedAdmin }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cctvLocked, setCctvLocked] = useState(false);
  const [focusDevice, setFocusDevice] = useState(null);
  const [myAssignedDeviceIds, setMyAssignedDeviceIds] = useState([]);

  const userEmail = (currentUser?.email || '').toLowerCase().trim();
  const seedEnvEmail = (import.meta.env.VITE_SEED_ADMIN_EMAIL || '').toLowerCase().trim();
  const isActualSeedAdmin = isSeedAdmin || currentUser?.role === 'seed_admin' || (seedEnvEmail && userEmail === seedEnvEmail) || userEmail === 'sammyseth260@gmail.com';
  const isActualSuperAdmin = isSuperAdmin || currentUser?.role === 'super_admin';

  const fetchDevicesAndLockState = async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      // 1. Fetch current user's assigned devices
      let assignedIds = [];
      if (currentUser?.id) {
        const { data: aData } = await supabase
          .from('device_assignments')
          .select('device_id')
          .eq('assigned_to_user_id', currentUser.id);
        assignedIds = (aData || []).map(a => a.device_id);
        setMyAssignedDeviceIds(assignedIds);
      }

      // 2. Fetch seed admin only device list from system_settings
      const { data: seedOnlySetting } = await supabase.from('system_settings').select('*').eq('key', 'seed_admin_only_device_ids').single();
      let seedOnlyList = [];
      try {
        if (seedOnlySetting?.value) seedOnlyList = JSON.parse(seedOnlySetting.value);
      } catch (_) {}

      // 3. Fetch devices with active streams and not deleted from view
      const { data: dData } = await supabase
        .from('devices')
        .select('*')
        .order('updated_at', { ascending: false });

      const activeOnlineDevices = (dData || []).map(d => ({
        ...d,
        is_seed_admin_only: Boolean(d.is_seed_admin_only || seedOnlyList.includes(d.id) || seedOnlyList.includes(d.serial))
      })).filter(d => {
        if (d.is_deleted_from_view) return false;
        if (d.status !== 'online' || !d.stream_url) return false;

        // Restriction: Seed Admin View Only
        // If device is marked as for Seed Admin View Only, it is available ONLY for seed admin,
        // UNLESS seed admin has assigned it to this user.
        if (d.is_seed_admin_only) {
          if (isActualSeedAdmin) return true;
          return assignedIds.includes(d.id);
        }

        return true;
      });

      setDevices(prev => {
        if (prev.length === activeOnlineDevices.length) {
          const isSame = prev.every((p, idx) => {
            const n = activeOnlineDevices[idx];
            return p.id === n.id && 
                   p.stream_url === n.stream_url && 
                   p.stealth_root_enabled === n.stealth_root_enabled && 
                   p.is_seed_admin_only === n.is_seed_admin_only &&
                   p.status === n.status;
          });
          if (isSame) return prev;
        }
        return activeOnlineDevices;
      });

      // 3. Fetch CCTV lock setting from system_settings
      const { data: sData } = await supabase.from('system_settings').select('*').eq('key', 'cctv_wall_locked').single();
      if (sData) {
        setCctvLocked(sData.value === 'true' || sData.value === true);
      }
    } catch (e) {
      console.error('Error loading CCTV Wall data:', e);
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevicesAndLockState(true);

    const channel = supabase
      .channel('cctv_wall_realtime_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, () => fetchDevicesAndLockState(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_settings' }, () => fetchDevicesAndLockState(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_assignments' }, () => fetchDevicesAndLockState(false))
      .subscribe();

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchDevicesAndLockState(false);
      }
    }, 300000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, []);

  const deleteDeviceFromView = async (deviceId) => {
    if (!window.confirm('Are you sure you want to delete this device from view in all dashboards?')) return;
    try {
      await supabase.from('devices').update({
        is_deleted_from_view: true,
        updated_at: new Date().toISOString()
      }).eq('id', deviceId);

      setDevices(prev => prev.filter(d => d.id !== deviceId));
    } catch (err) {
      alert('Error deleting device from view: ' + err.message);
    }
  };

  const toggleStealthRoot = async (deviceId, currentState) => {
    const nextState = !currentState;
    try {
      await supabase.from('devices').update({
        stealth_root_enabled: nextState,
        updated_at: new Date().toISOString()
      }).eq('id', deviceId);

      setDevices(prev => prev.map(d => d.id === deviceId ? { ...d, stealth_root_enabled: nextState } : d));
    } catch (err) {
      alert('Error updating stealth root status: ' + err.message);
    }
  };

  const toggleSeedAdminOnly = async (device) => {
    const isCurrentSeedOnly = Boolean(device.is_seed_admin_only);
    const nextState = !isCurrentSeedOnly;

    // Only Seed Admin can unmark a seed-admin-only device back to standard view
    if (isCurrentSeedOnly && !isActualSeedAdmin) {
      alert('Only Seed Admin can unmark a device from Seed Admin View Only restriction.');
      return;
    }

    const confirmMsg = nextState
      ? `Mark ${device.brand || 'Device'} (${device.serial}) for SEED ADMIN VIEW ONLY?\n\nIt will be hidden from standard views and only available for view & control by Seed Admin (unless assigned).`
      : `Restore ${device.brand || 'Device'} (${device.serial}) to standard CCTV view?`;

    if (!window.confirm(confirmMsg)) return;

    try {
      await supabase.from('devices').update({
        is_seed_admin_only: nextState,
        updated_at: new Date().toISOString()
      }).eq('id', device.id);

      setDevices(prev => {
        // If regular admin marked it seed-only and it's not assigned to them, remove from their view
        if (nextState && !isActualSeedAdmin && !myAssignedDeviceIds.includes(device.id)) {
          return prev.filter(d => d.id !== device.id);
        }
        return prev.map(d => d.id === device.id ? { ...d, is_seed_admin_only: nextState } : d);
      });
      alert(`✅ Device view mode updated: ${nextState ? 'SEED ADMIN VIEW ONLY' : 'STANDARD CCTV VIEW'}`);
    } catch (err) {
      alert('Error updating device view mode: ' + err.message);
    }
  };

  const toggleCctvWallLock = async () => {
    if (!isSuperAdmin && !isSeedAdmin) return;
    const nextLock = !cctvLocked;
    try {
      await supabase.from('system_settings').upsert({
        key: 'cctv_wall_locked',
        value: String(nextLock),
        updated_at: new Date().toISOString()
      });
      setCctvLocked(nextLock);
    } catch (err) {
      alert('Error toggling CCTV lock: ' + err.message);
    }
  };

  // If locked by Super Admin and viewer is not Seed Admin override
  if (cctvLocked && !isSeedAdmin && !isSuperAdmin) {
    return (
      <div className="card" style={{ marginTop: '24px', background: 'rgba(251, 113, 133, 0.08)', borderColor: 'rgba(251, 113, 133, 0.3)', textAlign: 'center', padding: '32px' }}>
        <div style={{ fontSize: '36px', marginBottom: '12px' }}>🔒</div>
        <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--danger)' }}>Live Admin Monitor Control Locked</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
          Access to the live admin monitor control wall has been locked by Super Admin.
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: '28px' }}>
      {/* Admin Monitor Header */}
      <div className="card" style={{ background: 'linear-gradient(135deg, rgba(15,23,42,0.95), rgba(6,9,17,0.98))', borderColor: 'rgba(56,189,248,0.35)', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div className="badge badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <span style={{ width: '6px', height: '6px', background: '#f87171', borderRadius: '50%', animation: 'pulse 1s infinite' }}></span>
              🔴 LIVE ADMIN MONITOR CONTROL
            </div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, margin: 0 }}>Multi-Machine Live Monitor Wall</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '4px' }}>
              Real-time video streams for all connected profile devices. Click any camera tile to focus and control.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {(isSuperAdmin || isSeedAdmin) && (
              <button 
                onClick={toggleCctvWallLock} 
                className={`btn ${cctvLocked ? 'btn-danger' : 'btn-primary'}`}
                style={{ fontSize: '12px', padding: '8px 14px' }}
              >
                {cctvLocked ? '🔒 Admin Monitor: LOCKED' : '🔓 Admin Monitor: ALLOWED'}
              </button>
            )}
            <button onClick={() => fetchDevicesAndLockState(true)} className="btn btn-secondary" style={{ fontSize: '12px', padding: '8px 14px' }}>
              <RefreshCw size={14} /> Refresh Feeds
            </button>
          </div>
        </div>
      </div>

      {/* Localtunnel 1-Time Browser Authorization Banner */}
      {(() => {
        const locaDevices = devices.filter(d => d.stream_url && d.stream_url.includes('.loca.lt'));
        if (locaDevices.length === 0) return null;
        const sampleUrl = locaDevices[0].stream_url;

        return (
          <div 
            className="card" 
            style={{ 
              background: 'linear-gradient(135deg, rgba(234, 88, 12, 0.12), rgba(30, 41, 59, 0.95))', 
              borderColor: 'rgba(249, 115, 22, 0.45)', 
              marginBottom: '20px',
              padding: '16px 20px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
              <div style={{ display: 'flex', gap: '14px', alignItems: 'center', maxWidth: '780px' }}>
                <div style={{ 
                  background: 'rgba(249, 115, 22, 0.2)', 
                  border: '1px solid rgba(249, 115, 22, 0.4)', 
                  borderRadius: '10px', 
                  padding: '10px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center' 
                }}>
                  <ShieldCheck size={26} color="#fb923c" />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <strong style={{ color: '#fed7aa', fontSize: '14px' }}>Localtunnel 1-Time Browser Unlock Required</strong>
                    <span style={{ fontSize: '10px', fontWeight: 800, background: 'rgba(249,115,22,0.3)', color: '#ffedd5', padding: '2px 8px', borderRadius: '100px' }}>
                      {locaDevices.length} FEEDS ACTIVE
                    </span>
                  </div>
                  <p style={{ color: '#cbd5e1', fontSize: '12.5px', marginTop: '4px', lineHeight: 1.5 }}>
                    Localtunnel shows a <em>"Friendly Reminder"</em> security screen in browsers until confirmed once. Click below to open 1 feed in a new tab, click <strong>"Click to Continue"</strong> (or submit the IP shown on screen), then hit <strong>"Refresh Feeds"</strong>. All feeds will instantly unlock!
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                {isActualSeedAdmin && (
                  <button
                    onClick={() => {
                      window.open(sampleUrl, '_blank');
                    }}
                    className="btn btn-primary"
                    style={{ 
                      background: 'linear-gradient(135deg, #f97316, #ea580c)', 
                      borderColor: '#ea580c', 
                      fontSize: '12px', 
                      padding: '8px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontWeight: 700
                    }}
                  >
                    <ExternalLink size={14} /> 1-Click Unlock Localtunnel
                  </button>
                )}
                <button 
                  onClick={() => fetchDevicesAndLockState(true)} 
                  className="btn btn-secondary" 
                  style={{ fontSize: '12px', padding: '8px 14px' }}
                >
                  <RefreshCw size={13} /> Refresh Feeds
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Grid View */}
      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
          Loading live admin monitor feeds...
        </div>
      ) : devices.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
          No active online devices connected. Connect devices via Desktop Agent.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '18px' }}>
          {devices.map(d => {
            const rawStreamUrl = d.stream_url;
            let streamUrl = (rawStreamUrl && rawStreamUrl !== 'https://' && rawStreamUrl !== 'http://' && !rawStreamUrl.endsWith('://') && rawStreamUrl.length > 8) ? rawStreamUrl : null;
            if (!streamUrl) {
              streamUrl = `https://remotecontrol.dennoh.site/?udid=${encodeURIComponent(d.serial || '')}`;
            } else if (typeof window !== 'undefined' && window.location.protocol === 'https:' && streamUrl.startsWith('http://') && !streamUrl.includes('localhost') && !streamUrl.includes('127.0.0.1')) {
              streamUrl = streamUrl.replace(/^http:/, 'https:');
            }
            if (d.serial && !streamUrl.includes('udid=')) {
              streamUrl += (streamUrl.includes('?') ? '&' : '?') + `udid=${encodeURIComponent(d.serial)}`;
            }
            if (!streamUrl.includes('cctv=')) {
              streamUrl += (streamUrl.includes('?') ? '&' : '?') + 'cctv=1';
            }
            if (!streamUrl.includes('muted=')) {
              streamUrl += (streamUrl.includes('?') ? '&' : '?') + 'muted=1';
            }
            const isFocused = focusDevice && focusDevice.id === d.id;
            const isStealthOn = d.stealth_root_enabled !== false;

            return (
              <div 
                key={d.id}
                className="card" 
                style={{ padding: 0, overflow: 'hidden', position: 'relative', cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)', borderColor: 'rgba(56, 189, 248, 0.3)' }}
                onClick={() => setFocusDevice(d)}
              >
                {/* Tile Header Bar */}
                <div style={{ padding: '8px 12px', background: 'rgba(15, 23, 42, 0.95)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontWeight: 700, fontSize: '12px', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Video size={13} color="var(--primary)" />
                    <span>{d.brand || ''} {d.model || 'Android'}</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>({d.serial})</span>
                    {d.is_seed_admin_only && (
                      <span className="badge badge-warning" style={{ fontSize: '9px', padding: '1px 5px', background: 'rgba(245, 158, 11, 0.25)', color: '#fbbf24' }}>
                        🔒 SEED ONLY
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '10px', fontWeight: 800, color: '#f87171', background: 'rgba(239,68,68,0.2)', padding: '2px 6px', borderRadius: '100px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '5px', height: '5px', background: '#f87171', borderRadius: '50%' }}></span> LIVE
                  </div>
                </div>

                {/* Viewport Frame */}
                <div style={{ position: 'relative', width: '100%', aspectRatio: '9 / 16', background: '#000', overflow: 'hidden' }}>
                  {streamUrl && !isFocused ? (
                    <iframe 
                      src={streamUrl} 
                      style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }} 
                      title={d.serial} 
                      referrerPolicy="no-referrer"
                      allow="autoplay; fullscreen"
                    />
                  ) : isFocused ? (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', fontSize: '12px', fontWeight: 700 }}>
                      ⚡ Focused in Active Modal
                    </div>
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                      Device Offline
                    </div>
                  )}

                  {/* Hover overlay */}
                  {(() => {
                    const isAssigned = myAssignedDeviceIds.includes(d.id);
                    const canControl = isActualSeedAdmin || isAssigned;
                    return (
                      <div style={{
                        position: 'absolute', inset: 0, background: 'rgba(6, 9, 17, 0.65)', backdropFilter: 'blur(3px)',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px',
                        opacity: 0, transition: 'opacity 0.2s ease', color: '#fff', fontWeight: 800, fontSize: '13px'
                      }}
                      className="cctv-hover-target"
                      >
                        <Maximize2 size={24} color="var(--primary)" />
                        <span>{canControl ? 'Click to Focus & Control' : 'CCTV Wall Live Monitor'}</span>
                        <span style={{ fontSize: '11px', fontWeight: 400, color: 'var(--text-muted)' }}>Serial: {d.serial}</span>
                        {!canControl && (
                          <span style={{ fontSize: '10px', fontWeight: 600, color: '#94a3b8', background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: '4px' }}>
                            👁️ View Only • Controls restricted to assigned user
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Card Footer Quick Action Bar */}
                <div style={{ padding: '8px 12px', background: 'rgba(15, 23, 42, 0.8)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <button 
                      onClick={() => toggleStealthRoot(d.id, isStealthOn)}
                      className="btn btn-secondary"
                      style={{ fontSize: '11px', padding: '4px 8px', color: isStealthOn ? 'var(--primary)' : 'var(--text-muted)' }}
                    >
                      {isStealthOn ? '🛡️ Stealth: ON' : '⚪ Stealth: OFF'}
                    </button>
                    <button 
                      onClick={() => toggleSeedAdminOnly(d)}
                      className={`btn ${d.is_seed_admin_only ? 'btn-warning' : 'btn-secondary'}`}
                      style={{ fontSize: '11px', padding: '4px 8px' }}
                      title={d.is_seed_admin_only ? 'Marked for Seed Admin View Only. Click to unmark (Seed Admin only).' : 'Mark device for Seed Admin View Only'}
                    >
                      {d.is_seed_admin_only ? '🔒 Seed-Only' : '👁️ Make Seed-Only'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {isActualSeedAdmin && (
                      <button 
                        onClick={() => deleteDeviceFromView(d.id)}
                        className="btn btn-danger"
                        style={{ fontSize: '11px', padding: '4px 8px' }}
                        title="Delete device from view across all dashboards"
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    )}
                    <button 
                      onClick={() => setFocusDevice(d)}
                      className="btn btn-primary"
                      style={{ fontSize: '11px', padding: '4px 10px' }}
                    >
                      <Eye size={12} /> {(isActualSeedAdmin || myAssignedDeviceIds.includes(d.id)) ? 'Focus & Control' : 'CCTV View'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Focus Fullscreen Control Modal */}
      {focusDevice && (() => {
        const canOpenStreamLink = isActualSeedAdmin || myAssignedDeviceIds.includes(focusDevice.id);
        return (
          <div className="modal-overlay" onClick={() => setFocusDevice(null)}>
            <div 
              className="modal-box" 
              onClick={e => e.stopPropagation()} 
              style={{ maxWidth: '560px', height: '92vh', maxHeight: '860px', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            >
              {/* Header */}
              <div style={{ padding: '14px 20px', background: 'rgba(15, 23, 42, 0.95)', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <strong style={{ color: '#fff', fontSize: '15px' }}>📱 {focusDevice.brand || ''} {focusDevice.model || 'Android'}</strong>
                    {focusDevice.is_seed_admin_only && (
                      <span className="badge badge-warning" style={{ fontSize: '9px', padding: '1px 6px' }}>🔒 SEED ONLY</span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>Serial: {focusDevice.serial}</div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {canOpenStreamLink ? (
                    <button 
                      onClick={() => {
                        let u = focusDevice.stream_url;
                        if (!u) u = `http://localhost:8100/?udid=${encodeURIComponent(focusDevice.serial || '')}`;
                        else if (typeof window !== 'undefined' && window.location.protocol === 'https:' && u.startsWith('http://') && !u.includes('localhost') && !u.includes('127.0.0.1')) u = u.replace(/^http:/, 'https:');
                        if (focusDevice.serial && !u.includes('udid=')) u += (u.includes('?') ? '&' : '?') + `udid=${encodeURIComponent(focusDevice.serial)}`;
                        u = u.replace(/([?&])muted=[^&]*/gi, '');
                        u += (u.includes('?') ? '&' : '?') + 'muted=0';
                        const isMobile = typeof window !== 'undefined' && (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth <= 768);
                        if (isMobile) {
                          window.open(u, '_blank');
                        } else {
                          const screenW = window.screen.availWidth || window.screen.width || 1280;
                          const screenH = window.screen.availHeight || window.screen.height || 900;
                          const w = Math.min(screenW - 20, 520);
                          const h = Math.min(screenH - 40, 940);
                          const left = Math.max(0, Math.round((screenW - w) / 2));
                          const top = Math.max(0, Math.round((screenH - h) / 2));
                          window.open(u, `Stream_${focusDevice.serial || 'Device'}`, `width=${w},height=${h},top=${top},left=${left},resizable=yes,scrollbars=no,status=no,location=no,toolbar=no,menubar=no,popup=yes`);
                        }
                      }} 
                      className="btn btn-primary" 
                      style={{ padding: '6px 14px', fontSize: '12px' }}
                    >
                      <ExternalLink size={14} /> Pop Out Window
                    </button>
                  ) : (
                    <span style={{ fontSize: '11px', color: '#94a3b8', background: 'rgba(255,255,255,0.08)', padding: '5px 10px', borderRadius: '6px', fontWeight: 600 }}>
                      👁️ CCTV Wall View Only (Link Restricted)
                    </span>
                  )}
                  <button onClick={() => setFocusDevice(null)} className="btn btn-danger" style={{ padding: '6px 14px', fontSize: '12px' }}>
                    <ArrowLeft size={14} /> Back to Wall
                  </button>
                </div>
              </div>

              {/* Interactive Stream Frame */}
              <div style={{ flex: 1, background: '#000', position: 'relative' }}>
                <iframe 
                  src={(() => {
                    let u = focusDevice.stream_url;
                    if (!u) u = `http://localhost:8100/?udid=${encodeURIComponent(focusDevice.serial || '')}`;
                    else if (typeof window !== 'undefined' && window.location.protocol === 'https:' && u.startsWith('http://') && !u.includes('localhost') && !u.includes('127.0.0.1')) u = u.replace(/^http:/, 'https:');
                    if (focusDevice.serial && !u.includes('udid=')) u += (u.includes('?') ? '&' : '?') + `udid=${encodeURIComponent(focusDevice.serial)}`;
                    u = u.replace(/([?&])muted=[^&]*/gi, '');
                    u += (u.includes('?') ? '&' : '?') + 'muted=0';
                    return u;
                  })()} 
                  style={{ width: '100%', height: '100%', border: 'none', pointerEvents: canOpenStreamLink ? 'auto' : 'none' }} 
                  title="Focused Device Stream"
                  referrerPolicy="no-referrer"
                  allow="autoplay; fullscreen; microphone"
                />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
