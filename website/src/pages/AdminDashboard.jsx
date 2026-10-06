import React, { useEffect, useState } from 'react';
import DashboardLayout from '../layouts/DashboardLayout';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Users, RefreshCw, UserX, UserCheck } from 'lucide-react';
import CctvWall from '../components/CctvWall';
import DeviceAllocationSection from '../components/DeviceAllocationSection';

export default function AdminDashboard() {
  const { profile } = useAuth();
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [blockingId, setBlockingId] = useState(null);
  const [blockReasonModal, setBlockReasonModal] = useState(null);
  const [blockReason, setBlockReason] = useState('');

  const loadData = async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      // Fetch workers (workers and admins for management)
      const { data: wData } = await supabase.from('profiles').select('*').eq('role', 'worker').order('email', { ascending: true });
      setWorkers(wData || []);
    } catch (e) {
      console.error('Error loading admin worker data:', e);
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    loadData(true);

    const channel = supabase
      .channel('admin_dashboard_profiles_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => loadData(false))
      .subscribe();

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadData(false);
      }
    }, 300000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, []);

  const handleBlockUser = async (e) => {
    e.preventDefault();
    if (!blockReasonModal) return;
    setBlockingId(blockReasonModal.id);
    try {
      await supabase.from('profiles').update({
        is_blocked: true,
        blocked_reason: blockReason.trim() || 'Suspended by Admin',
        blocked_by: profile?.id,
        updated_at: new Date().toISOString(),
      }).eq('id', blockReasonModal.id);
      setBlockReasonModal(null);
      setBlockReason('');
      loadData();
    } catch (err) {
      alert('Error blocking user: ' + err.message);
    } finally {
      setBlockingId(null);
    }
  };

  const handleUnblockUser = async (userId) => {
    setBlockingId(userId);
    try {
      await supabase.from('profiles').update({
        is_blocked: false,
        blocked_reason: null,
        blocked_by: null,
        updated_at: new Date().toISOString(),
      }).eq('id', userId);
      loadData();
    } catch (err) {
      alert('Error unblocking user: ' + err.message);
    } finally {
      setBlockingId(null);
    }
  };

  const handleUnblockAllAuditSuspended = async () => {
    const auditSuspended = workers.filter(w => 
      w.is_auto_suspended && (
        (w.blocked_reason && w.blocked_reason.toLowerCase().includes('audit')) ||
        (w.blocked_reason && w.blocked_reason.toLowerCase().includes('weekly')) ||
        Boolean(w.auto_suspended_week)
      )
    );

    if (auditSuspended.length === 0) {
      alert('No workers are currently suspended by audit execution.');
      return;
    }

    if (!window.confirm(`Unblock all ${auditSuspended.length} workers that were suspended by audit execution in one click?`)) return;

    try {
      const ids = auditSuspended.map(w => w.id);
      await supabase
        .from('profiles')
        .update({
          is_auto_suspended: false,
          is_blocked: false,
          auto_suspended_week: null,
          blocked_reason: null,
          updated_at: new Date().toISOString()
        })
        .in('id', ids);

      alert(`✅ Successfully unblocked all ${auditSuspended.length} audit-suspended workers!`);
      loadData(false);
    } catch (err) {
      alert('Error unblocking workers: ' + err.message);
    }
  };

  return (
    <DashboardLayout>
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users size={24} color="var(--primary)" />
            <h1 style={{ fontSize: '24px', fontWeight: 800 }}>Admin Allocation Hub</h1>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginTop: '4px' }}>
            Assign device stream links to workers and admins with auto-generated passwords for password-protected access.
          </p>
        </div>
        <button onClick={loadData} className="btn btn-secondary">
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      {/* Real-time Security CCTV Camera Wall */}
      <CctvWall currentUser={profile} isSuperAdmin={false} />

      {/* Device Allocation Section */}
      <div style={{ marginBottom: '28px' }}>
        <DeviceAllocationSection currentUser={profile} />
      </div>

      {/* Worker Block Management */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users size={18} color="var(--accent)" /> Worker Access Control
          </h3>
          <button
            onClick={handleUnblockAllAuditSuspended}
            style={{
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              color: '#10b981',
              padding: '7px 14px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            🔓 1-Click Unblock Audit Suspensions
          </button>
        </div>

        {workers.length === 0 ? (
          <div style={{ color: 'var(--text-muted)' }}>No workers registered yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontSize: '12px' }}>
                  <th style={{ padding: '12px' }}>WORKER EMAIL</th>
                  <th style={{ padding: '12px' }}>STATUS</th>
                  <th style={{ padding: '12px' }}>BLOCK REASON</th>
                  <th style={{ padding: '12px', textAlign: 'right' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {workers.map(w => (
                  <tr key={w.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '14px 12px', fontWeight: 600 }}>{w.email}</td>
                    <td style={{ padding: '14px 12px' }}>
                      {w.is_auto_suspended ? (
                        <span className="badge badge-danger" style={{ background: '#7f1d1d', color: '#fecaca' }}>
                          <UserX size={11} /> AUTO-TERMINATED
                        </span>
                      ) : w.is_blocked ? (
                        <span className="badge badge-danger"><UserX size={11} /> BLOCKED</span>
                      ) : (
                        <span className="badge badge-success"><UserCheck size={11} /> ACTIVE</span>
                      )}
                    </td>
                    <td style={{ padding: '14px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      {w.is_auto_suspended ? 'System Target Rule Violation (Must leave station before 8 AM)' : (w.blocked_reason || '—')}
                    </td>
                    <td style={{ padding: '14px 12px', textAlign: 'right' }}>
                      {w.is_auto_suspended ? (
                        <span style={{ fontSize: '11px', color: '#ef4444', fontWeight: 700, padding: '4px 8px', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.1)' }}>
                          Seed Admin Clearance Required
                        </span>
                      ) : w.is_blocked ? (
                        <button
                          onClick={() => handleUnblockUser(w.id)}
                          disabled={blockingId === w.id}
                          className="btn btn-primary"
                          style={{ padding: '6px 14px', fontSize: '12px' }}
                        >
                          <UserCheck size={14} /> Unblock
                        </button>
                      ) : (
                        <button
                          onClick={() => { setBlockReasonModal(w); setBlockReason(''); }}
                          disabled={blockingId === w.id}
                          className="btn btn-danger"
                          style={{ padding: '6px 14px', fontSize: '12px' }}
                        >
                          <UserX size={14} /> Block
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Block Reason Modal */}
      {blockReasonModal && (
        <div className="modal-overlay" onClick={() => setBlockReasonModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)' }}>
              <UserX size={20} /> Block Worker
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '16px' }}>
              Blocking <strong style={{ color: 'var(--text-main)' }}>{blockReasonModal.email}</strong>. They will immediately see an "Access Revoked" screen.
            </p>
            <form onSubmit={handleBlockUser} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>REASON (optional)</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. Account suspended"
                  value={blockReason}
                  onChange={e => setBlockReason(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '6px' }}>
                <button type="button" onClick={() => setBlockReasonModal(null)} className="btn btn-secondary">Cancel</button>
                <button type="submit" className="btn btn-danger" disabled={blockingId}>
                  <UserX size={14} /> Confirm Block
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
