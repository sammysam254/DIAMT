import React, { useEffect, useState } from 'react';
import DashboardLayout from '../layouts/DashboardLayout';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { 
  FileText, CheckCircle2, Clock, XCircle, Download, Calendar, 
  DollarSign, Users, Filter, Check, X, ShieldAlert, RefreshCw, AlertTriangle, ShieldCheck,
  Zap, Sparkles, Send, Bell
} from 'lucide-react';
import SEO from '../components/SEO';
import DiamtLoader from '../components/DiamtLoader';
import { 
  generateAdminWeeklyClaimsReportPdf, 
  generateWeeklyWorkerClaimsPdf 
} from '../lib/pdfGenerator';
import { 
  getISOWeekString, getRecentWeekIdentifiers, DAYS_OF_WEEK, 
  getDateForDayInWeek, getTodayDateString 
} from '../lib/weekUtils';
import { notifyClaimAction, sendNotificationToUser } from '../lib/notificationService';

export default function AdminClaims() {
  const { profile } = useAuth();
  const [selectedWeek, setSelectedWeek] = useState(getISOWeekString());
  const [weekList, setWeekList] = useState([]);
  const [selectedWorkerFilter, setSelectedWorkerFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  
  const [claims, setClaims] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState(null);
  
  // Rejection modal
  const [rejectionModal, setRejectionModal] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');

  // Seed Admin Advance Claim Modal
  const [showSeedClaimModal, setShowSeedClaimModal] = useState(false);
  const [seedTargetWorkerId, setSeedTargetWorkerId] = useState('');
  const [seedTargetWeek, setSeedTargetWeek] = useState(getISOWeekString());
  const [seedTargetDay, setSeedTargetDay] = useState('Monday');
  const [seedClaimAmount, setSeedClaimAmount] = useState('10.00');
  const [seedPlanType, setSeedPlanType] = useState('daily_10');
  const [seedAdminNotes, setSeedAdminNotes] = useState('');
  const [seedSubmitting, setSeedSubmitting] = useState(false);

  // Send Notification Modal
  const [showSendNotifModal, setShowSendNotifModal] = useState(false);
  const [notifTargetWorkerId, setNotifTargetWorkerId] = useState('ALL');
  const [notifTitle, setNotifTitle] = useState('');
  const [notifMessage, setNotifMessage] = useState('');
  const [notifType, setNotifType] = useState('info');
  const [sendingNotif, setSendingNotif] = useState(false);

  const isSeedAdmin = profile?.role === 'seed_admin' || profile?.email?.toLowerCase() === 'sammyseth260@gmail.com';

  useEffect(() => {
    setWeekList(getRecentWeekIdentifiers(12));
  }, []);

  const loadData = async (isInitial = false) => {
    if (isInitial) setLoading(true);

    try {
      // 1. Fetch workers
      const { data: wData } = await supabase
        .from('profiles')
        .select('*')
        .order('email', { ascending: true });
      setWorkers(wData || []);

      // 2. Fetch claims for selected week
      let query = supabase
        .from('worker_claims')
        .select('*')
        .eq('week_identifier', selectedWeek)
        .order('created_at', { ascending: false });

      const { data: cData, error } = await query;
      if (error) throw error;
      setClaims(cData || []);
    } catch (err) {
      console.error('Error loading admin claims:', err);
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    loadData(true);

    const channel = supabase
      .channel(`admin-claims-sync-${selectedWeek}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'worker_claims',
      }, () => {
        loadData(false);
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'profiles',
      }, () => {
        loadData(false);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedWeek]);

  // Handle Approving Claim (One-click finalize, no payout needed)
  const handleApproveClaim = async (claim) => {
    setActionInProgress(claim.id);
    try {
      const { error } = await supabase
        .from('worker_claims')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          approved_by: profile.id,
          approver_email: profile.email,
          rejection_reason: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', claim.id);

      if (error) throw error;

      // Realtime notification to worker (triggers ding sound)
      await notifyClaimAction({
        workerId: claim.worker_id,
        workerEmail: claim.worker_email,
        action: 'approved',
        amount: claim.amount,
        dayOrWeek: claim.day_of_week,
        weekIdentifier: claim.week_identifier,
        approverEmail: profile.email
      });

      await loadData(false);
    } catch (err) {
      alert('Error approving claim: ' + err.message);
    } finally {
      setActionInProgress(null);
    }
  };

  // Handle Rejecting Claim
  const handleRejectClaim = async () => {
    if (!rejectionModal) return;
    setActionInProgress(rejectionModal.id);
    try {
      const { error } = await supabase
        .from('worker_claims')
        .update({
          status: 'rejected',
          rejection_reason: rejectionReason || 'Rejected by Administrator',
          approved_at: null,
          approved_by: profile.id,
          approver_email: profile.email,
          updated_at: new Date().toISOString()
        })
        .eq('id', rejectionModal.id);

      if (error) throw error;

      // Realtime rejection notification to worker (triggers ding sound)
      await notifyClaimAction({
        workerId: rejectionModal.worker_id,
        workerEmail: rejectionModal.worker_email,
        action: 'rejected',
        amount: rejectionModal.amount,
        dayOrWeek: rejectionModal.day_of_week,
        weekIdentifier: rejectionModal.week_identifier,
        reason: rejectionReason,
        approverEmail: profile.email
      });

      setRejectionModal(null);
      setRejectionReason('');
      await loadData(false);
    } catch (err) {
      alert('Error rejecting claim: ' + err.message);
    } finally {
      setActionInProgress(null);
    }
  };

  // Seed Admin exclusive: Unsuspend Auto-Suspended Account
  const handleUnsuspendWorker = async (workerId) => {
    if (!isSeedAdmin) {
      alert('Permission Denied: Only the Seed Administrator has clearance to unsuspend accounts terminated by target rule violation.');
      return;
    }
    if (!window.confirm('Reinstate this auto-suspended worker account? This will clear suspension flags and restore facility access.')) return;

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          is_auto_suspended: false,
          is_blocked: false,
          auto_suspended_week: null,
          blocked_reason: null
        })
        .eq('id', workerId);

      if (error) throw error;
      alert('Worker successfully reinstated and unsuspended.');
      await loadData(false);
    } catch (err) {
      alert('Error unsuspending worker: ' + err.message);
    }
  };

  // Admin one-click unblock for all workers suspended by audit execution
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

    if (!window.confirm(`Unblock all ${auditSuspended.length} workers that were suspended by audit execution in one click? This will restore their active account status.`)) return;

    setActionInProgress('unblock-all-audit');
    try {
      const ids = auditSuspended.map(w => w.id);
      const { error } = await supabase
        .from('profiles')
        .update({
          is_auto_suspended: false,
          is_blocked: false,
          auto_suspended_week: null,
          blocked_reason: null,
          updated_at: new Date().toISOString()
        })
        .in('id', ids);

      if (error) throw error;

      alert(`✅ Successfully unblocked all ${auditSuspended.length} audit-suspended workers in one click!`);
      await loadData(false);
    } catch (err) {
      alert('Error unblocking workers: ' + err.message);
    } finally {
      setActionInProgress(null);
    }
  };

  // Admin direct notification dispatcher
  const handleAdminSendNotification = async (e) => {
    e.preventDefault();
    if (!notifTitle.trim() || !notifMessage.trim()) {
      alert('Please provide both title and message.');
      return;
    }

    setSendingNotif(true);
    try {
      if (notifTargetWorkerId === 'ALL') {
        const workerList = workers.filter(w => w.role === 'worker');
        for (const w of workerList) {
          await sendNotificationToUser({
            userId: w.id,
            userEmail: w.email,
            title: notifTitle.trim(),
            message: notifMessage.trim(),
            type: notifType
          });
        }
        alert(`✅ Notification dispatched to all ${workerList.length} workers!`);
      } else {
        const targetWorker = workers.find(w => w.id === notifTargetWorkerId);
        if (targetWorker) {
          await sendNotificationToUser({
            userId: targetWorker.id,
            userEmail: targetWorker.email,
            title: notifTitle.trim(),
            message: notifMessage.trim(),
            type: notifType
          });
          alert(`✅ Notification dispatched to ${targetWorker.email}!`);
        }
      }

      setShowSendNotifModal(false);
      setNotifTitle('');
      setNotifMessage('');
    } catch (err) {
      alert('Error sending notification: ' + err.message);
    } finally {
      setSendingNotif(false);
    }
  };

  // Seed Admin exclusive: Issue claim for a worker (even future days)
  const handleSeedCreateClaim = async (e) => {
    e.preventDefault();
    if (!isSeedAdmin) {
      alert('Permission Denied: Only the Seed Administrator can force-claim days for workers.');
      return;
    }

    const targetWorker = workers.find(w => w.id === seedTargetWorkerId);
    if (!targetWorker) {
      alert('Please select a target worker.');
      return;
    }

    setSeedSubmitting(true);
    try {
      const isWeekly = seedPlanType === 'weekly_40';
      const dayVal = isWeekly ? 'Weekly' : seedTargetDay;
      const calculatedDate = getDateForDayInWeek(seedTargetWeek, dayVal);

      const claimRecord = {
        worker_id: targetWorker.id,
        worker_email: targetWorker.email,
        week_identifier: seedTargetWeek,
        day_of_week: dayVal,
        claim_date: calculatedDate,
        amount: parseFloat(seedClaimAmount) || (isWeekly ? 40.00 : 10.00),
        plan_type: seedPlanType,
        status: 'approved', // Pre-authorized & approved by Seed Admin
        approved_at: new Date().toISOString(),
        approved_by: profile.id,
        approver_email: profile.email,
        is_forced_by_seed: true,
        notes: seedAdminNotes || `Issued & pre-authorized by Seed Admin for ${dayVal} (${calculatedDate})`,
        claimed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('worker_claims')
        .upsert([claimRecord], { onConflict: 'worker_id, week_identifier, day_of_week' });

      if (error) throw error;

      // Send Seed claim notification to worker
      await notifyClaimAction({
        workerId: targetWorker.id,
        workerEmail: targetWorker.email,
        action: 'seed_issued',
        amount: claimRecord.amount,
        dayOrWeek: dayVal,
        weekIdentifier: seedTargetWeek,
        approverEmail: profile.email
      });

      alert(`✅ Seed Admin claim for ${targetWorker.email} (${dayVal}, ${calculatedDate}) recorded as worker claim and issued for Week ${seedTargetWeek}!`);
      setShowSeedClaimModal(false);
      setSeedAdminNotes('');
      await loadData(false);
    } catch (err) {
      alert('Error issuing claim: ' + err.message);
    } finally {
      setSeedSubmitting(false);
    }
  };

  // Filtered Claims
  const filteredClaims = claims.filter(c => {
    if (selectedWorkerFilter !== 'ALL' && c.worker_email !== selectedWorkerFilter) return false;
    if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
    return true;
  });

  // Export PDF Handler (Supports both all users and single user)
  const handleExportPdf = () => {
    if (selectedWorkerFilter !== 'ALL') {
      const targetWorker = workers.find(w => w.email === selectedWorkerFilter) || { email: selectedWorkerFilter };
      const workerClaims = claims.filter(c => c.worker_email === selectedWorkerFilter);
      generateWeeklyWorkerClaimsPdf({
        worker: targetWorker,
        weekIdentifier: selectedWeek,
        claims: workerClaims
      });
    } else {
      generateAdminWeeklyClaimsReportPdf({
        weekIdentifier: selectedWeek,
        claims: filteredClaims,
        workers: workers,
        filterWorkerEmail: null
      });
    }
  };

  // Calculations for summary cards
  const totalValue = filteredClaims.reduce((acc, c) => acc + (parseFloat(c.amount) || 0), 0);
  const approvedList = filteredClaims.filter(c => c.status === 'approved');
  const approvedTotal = approvedList.reduce((acc, c) => acc + (parseFloat(c.amount) || 0), 0);
  const pendingList = filteredClaims.filter(c => c.status === 'pending');
  const pendingTotal = pendingList.reduce((acc, c) => acc + (parseFloat(c.amount) || 0), 0);
  const rejectedList = filteredClaims.filter(c => c.status === 'rejected');

  return (
    <DashboardLayout>
      <SEO 
        title="Admin Claims & Audits | DIAMT Cloud" 
        description="Filter worker claims, verify submissions, and export executive green-themed audit PDF reports." 
      />

      {loading ? (
        <DiamtLoader 
          fullScreen={false} 
          text="AUDITING SYSTEM CLAIMS" 
          subtext="Loading verified claims and target performance ledgers..." 
        />
      ) : (
        <div style={{ maxWidth: '1300px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Header Bar */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '18px',
            padding: '24px',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{
                width: '52px',
                height: '52px',
                borderRadius: '14px',
                background: 'linear-gradient(135deg, #064e3b, #059669)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 16px rgba(5, 150, 105, 0.25)'
              }}>
                <FileText size={28} color="#ffffff" />
              </div>
              <div>
                <h1 style={{ fontSize: '22px', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                  Administrative Claims Management & Audits
                </h1>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                  Approve or reject worker claims. Once approved, the record is finalized. Filter by week and export professional green-theme PDFs.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  setNotifTargetWorkerId('ALL');
                  setNotifTitle('');
                  setNotifMessage('');
                  setShowSendNotifModal(true);
                }}
                style={{
                  background: 'rgba(59, 130, 246, 0.12)',
                  border: '1px solid rgba(59, 130, 246, 0.35)',
                  color: '#3b82f6',
                  padding: '10px 16px',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer'
                }}
              >
                <Bell size={16} /> Send Worker Notice
              </button>

              <button
                onClick={handleUnblockAllAuditSuspended}
                disabled={actionInProgress === 'unblock-all-audit'}
                style={{
                  background: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  color: '#10b981',
                  padding: '10px 16px',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer'
                }}
              >
                <ShieldCheck size={16} /> 1-Click Unblock Audit Suspensions
              </button>

              {isSeedAdmin && (
                <button
                  onClick={() => {
                    setSeedTargetWeek(selectedWeek);
                    const firstWorker = workers.find(w => w.role === 'worker');
                    if (firstWorker) {
                      setSeedTargetWorkerId(firstWorker.id);
                      setSeedPlanType(firstWorker.claim_criteria || 'daily_10');
                      setSeedClaimAmount(firstWorker.claim_criteria === 'weekly_40' ? '40.00' : '10.00');
                    }
                    setShowSeedClaimModal(true);
                  }}
                  style={{
                    background: 'linear-gradient(135deg, #059669, #10b981)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '10px 18px',
                    borderRadius: '10px',
                    fontSize: '13px',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(5, 150, 105, 0.3)'
                  }}
                >
                  <Zap size={16} /> Seed Admin: Issue Claim for Worker
                </button>
              )}

              <button
                onClick={handleExportPdf}
                style={{
                  background: 'linear-gradient(135deg, #064e3b, #059669)',
                  color: '#ffffff',
                  border: 'none',
                  padding: '10px 18px',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(5, 150, 105, 0.25)'
                }}
              >
                <Download size={16} />
                {selectedWorkerFilter !== 'ALL' 
                  ? `Export ${selectedWorkerFilter.split('@')[0]} PDF` 
                  : `Export Week ${selectedWeek} PDF (Green Theme)`}
              </button>
            </div>
          </div>

          {/* Filter Toolbar */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '16px',
            padding: '18px 24px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '20px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)', fontWeight: 700, fontSize: '13px' }}>
              <Filter size={16} color="var(--primary)" /> Filter Records:
            </div>

            {/* Filter 1: Week */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>Week:</span>
              <select
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(e.target.value)}
                style={{
                  background: 'var(--bg-main)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-main)',
                  borderRadius: '8px',
                  padding: '7px 12px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {weekList.map(w => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </div>

            {/* Filter 2: Worker */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>Worker:</span>
              <select
                value={selectedWorkerFilter}
                onChange={(e) => setSelectedWorkerFilter(e.target.value)}
                style={{
                  background: 'var(--bg-main)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-main)',
                  borderRadius: '8px',
                  padding: '7px 12px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  maxWidth: '240px'
                }}
              >
                <option value="ALL">All Workers ({claims.length} claims)</option>
                {workers.map(w => (
                  <option key={w.id} value={w.email}>
                    {w.email} {w.is_auto_suspended ? '(Suspended)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Filter 3: Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{
                  background: 'var(--bg-main)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-main)',
                  borderRadius: '8px',
                  padding: '7px 12px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <option value="ALL">All Statuses</option>
                <option value="pending">Pending Only</option>
                <option value="approved">Approved Only</option>
                <option value="rejected">Rejected Only</option>
              </select>
            </div>

            <button
              onClick={() => loadData(false)}
              style={{
                marginLeft: 'auto',
                background: 'none',
                border: '1px solid var(--border-color)',
                color: 'var(--text-muted)',
                padding: '7px 14px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <RefreshCw size={13} /> Refresh Ledgers
            </button>
          </div>

          {/* Metric Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '18px' }}>
              <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-muted)', fontWeight: 700 }}>
                Total Filtered Claims
              </span>
              <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-main)', marginTop: '6px' }}>
                ${totalValue.toFixed(2)}
              </div>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {filteredClaims.length} total entries recorded
              </span>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '18px' }}>
              <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-muted)', fontWeight: 700 }}>
                Approved (Finalized)
              </span>
              <div style={{ fontSize: '22px', fontWeight: 800, color: '#059669', marginTop: '6px' }}>
                ${approvedTotal.toFixed(2)}
              </div>
              <span style={{ fontSize: '12px', color: '#059669', fontWeight: 600 }}>
                {approvedList.length} approved by admin
              </span>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '18px' }}>
              <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-muted)', fontWeight: 700 }}>
                Pending Review
              </span>
              <div style={{ fontSize: '22px', fontWeight: 800, color: '#d97706', marginTop: '6px' }}>
                ${pendingTotal.toFixed(2)}
              </div>
              <span style={{ fontSize: '12px', color: '#d97706', fontWeight: 600 }}>
                {pendingList.length} awaiting authorization
              </span>
            </div>

            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', padding: '18px' }}>
              <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-muted)', fontWeight: 700 }}>
                Rejected
              </span>
              <div style={{ fontSize: '22px', fontWeight: 800, color: '#ef4444', marginTop: '6px' }}>
                {rejectedList.length}
              </div>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Claims declined
              </span>
            </div>
          </div>

          {/* Claims Table */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '18px',
            padding: '24px',
            overflowX: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                Claims Ledger ({selectedWeek})
              </h3>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Showing {filteredClaims.length} claim(s)
              </span>
            </div>

            {filteredClaims.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: '13px' }}>
                <FileText size={36} color="var(--border-color)" style={{ margin: '0 auto 12px' }} />
                No claims match the selected week or filters.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px' }}>Worker</th>
                    <th style={{ padding: '12px' }}>Day</th>
                    <th style={{ padding: '12px' }}>Claim Date</th>
                    <th style={{ padding: '12px' }}>Plan</th>
                    <th style={{ padding: '12px' }}>Amount</th>
                    <th style={{ padding: '12px' }}>Status</th>
                    <th style={{ padding: '12px' }}>Audit Information</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClaims.map((claim) => (
                    <tr key={claim.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '12px', fontWeight: 700, color: 'var(--text-main)' }}>
                        {claim.worker_email}
                      </td>
                      <td style={{ padding: '12px', color: 'var(--text-main)', fontWeight: 600 }}>
                        {claim.day_of_week}
                        {claim.is_forced_by_seed && (
                          <span style={{ fontSize: '10px', fontWeight: 800, color: '#059669', background: 'rgba(5, 150, 105, 0.12)', border: '1px solid #10b981', padding: '2px 6px', borderRadius: '4px', marginLeft: '6px' }}>
                            ★ SEED ISSUED
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '12px', color: 'var(--text-muted)' }}>
                        {claim.claim_date}
                      </td>
                      <td style={{ padding: '12px', color: 'var(--text-muted)' }}>
                        {claim.plan_type === 'weekly_40' ? 'Weekly $40' : 'Daily $10'}
                      </td>
                      <td style={{ padding: '12px', fontWeight: 800, color: '#059669' }}>
                        ${parseFloat(claim.amount).toFixed(2)}
                      </td>
                      <td style={{ padding: '12px' }}>
                        {claim.status === 'approved' && (
                          <span style={{ color: '#059669', background: 'rgba(5, 150, 105, 0.1)', padding: '4px 10px', borderRadius: '6px', fontWeight: 700, fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <CheckCircle2 size={12} /> APPROVED
                          </span>
                        )}
                        {claim.status === 'pending' && (
                          <span style={{ color: '#d97706', background: 'rgba(217, 119, 6, 0.1)', padding: '4px 10px', borderRadius: '6px', fontWeight: 700, fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <Clock size={12} /> PENDING
                          </span>
                        )}
                        {claim.status === 'rejected' && (
                          <span style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '4px 10px', borderRadius: '6px', fontWeight: 700, fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <XCircle size={12} /> REJECTED
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                        {claim.approver_email ? (
                          <span>Signed off by <b>{claim.approver_email}</b></span>
                        ) : claim.rejection_reason ? (
                          <span style={{ color: '#ef4444' }}>{claim.rejection_reason}</span>
                        ) : (
                          <span style={{ color: 'var(--text-dim)' }}>Pending Review</span>
                        )}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>
                        {claim.status === 'pending' ? (
                          <div style={{ display: 'inline-flex', gap: '8px' }}>
                            <button
                              onClick={() => handleApproveClaim(claim)}
                              disabled={actionInProgress === claim.id}
                              style={{
                                background: '#059669',
                                color: '#fff',
                                border: 'none',
                                padding: '6px 12px',
                                borderRadius: '8px',
                                fontSize: '12px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              <Check size={13} /> Approve
                            </button>
                            <button
                              onClick={() => { setRejectionModal(claim); setRejectionReason(''); }}
                              disabled={actionInProgress === claim.id}
                              style={{
                                background: 'rgba(239, 68, 68, 0.15)',
                                color: '#ef4444',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                padding: '6px 12px',
                                borderRadius: '8px',
                                fontSize: '12px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              <X size={13} /> Reject
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              const targetWorker = workers.find(w => w.id === claim.worker_id) || { email: claim.worker_email };
                              generateWeeklyWorkerClaimsPdf({
                                worker: targetWorker,
                                weekIdentifier: selectedWeek,
                                claims: claims.filter(c => c.worker_id === claim.worker_id)
                              });
                            }}
                            style={{
                              background: 'none',
                              border: '1px solid var(--border-color)',
                              color: 'var(--text-muted)',
                              padding: '5px 10px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <Download size={12} /> PDF
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Compliance & Auto-Suspension Audit Section */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '18px',
            padding: '24px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <ShieldAlert size={20} color="#b45309" />
                  <h3 style={{ fontSize: '16px', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                    Worker Target Compliance & System Auto-Suspension Audit
                  </h3>
                </div>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.6' }}>
                  Workers failing to achieve their weekly target rule (e.g. failing to submit the required $40 claim during their active week) are automatically suspended by system audit.
                  <b> Reinstating an auto-suspended worker is strictly restricted to Seed Admin authority.</b>
                </p>
              </div>

              {isSeedAdmin && (
                <button
                  onClick={async () => {
                    if (!window.confirm(`Execute Target Compliance Audit for Week ${selectedWeek}?\n\nAny workers on the Weekly $40 Plan who have not submitted their $40 claim for this week cycle will be automatically suspended by the system.`)) return;

                    const defaultingWorkers = workers.filter(w => {
                      if (w.role !== 'worker' || w.is_auto_suspended) return false;
                      if (w.claim_criteria === 'weekly_40') {
                        const hasClaim = claims.some(c => c.worker_id === w.id && (c.plan_type === 'weekly_40' || parseFloat(c.amount) >= 40));
                        return !hasClaim;
                      }
                      return false;
                    });

                    if (defaultingWorkers.length === 0) {
                      alert(`All evaluated workers are currently compliant for Week ${selectedWeek}. No suspensions enforced.`);
                      return;
                    }

                    for (const defWorker of defaultingWorkers) {
                      await supabase.from('profiles').update({
                        is_auto_suspended: true,
                        is_blocked: true,
                        auto_suspended_week: selectedWeek,
                        blocked_reason: `Due to failing to achieve weekly target rule as per your subscribed plan (Weekly $40 claim not submitted for week ${selectedWeek}), the system has auto-suspended you and you are required to leave the station before tomorrow at 8 AM, as your services are no longer needed.`
                      }).eq('id', defWorker.id);
                    }

                    alert(`Compliance Audit Executed for Week ${selectedWeek}:\n\n${defaultingWorkers.length} defaulting worker(s) have been auto-suspended.`);
                    loadData(false);
                  }}
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    color: '#ef4444',
                    padding: '8px 16px',
                    borderRadius: '10px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <AlertTriangle size={15} /> Execute Weekly Target Audit (Week {selectedWeek})
                </button>
              )}
            </div>

            <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' }}>
              {workers.filter(w => w.role === 'worker').map(w => {
                const isAutoSuspended = w.is_auto_suspended;
                const isWeeklyPlan = w.claim_criteria === 'weekly_40';
                const workerWeekClaims = claims.filter(c => c.worker_id === w.id);
                const hasWeekly40Sent = workerWeekClaims.some(c => c.plan_type === 'weekly_40' || parseFloat(c.amount) >= 40);

                return (
                  <div 
                    key={w.id}
                    style={{
                      background: isAutoSuspended ? 'rgba(239, 68, 68, 0.05)' : 'var(--bg-main)',
                      border: isAutoSuspended ? '1px solid #ef4444' : '1px solid var(--border-color)',
                      borderRadius: '12px',
                      padding: '14px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '12px'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)' }}>
                        {w.email}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Plan: <b>{isWeeklyPlan ? 'Weekly $40 Plan' : 'Daily $10 Plan'}</b>
                      </div>
                      <div style={{ marginTop: '6px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {isAutoSuspended ? (
                          <span style={{ fontSize: '10px', fontWeight: 800, color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                            AUTO-TERMINATED (Target Rule)
                          </span>
                        ) : isWeeklyPlan ? (
                          hasWeekly40Sent ? (
                            <span style={{ fontSize: '10px', fontWeight: 700, color: '#059669', background: 'rgba(5, 150, 105, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                              ✓ $40 Claim Sent (Compliant)
                            </span>
                          ) : (
                            <span style={{ fontSize: '10px', fontWeight: 700, color: '#d97706', background: 'rgba(217, 119, 6, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                              ⚠ $40 Claim Pending (At Risk)
                            </span>
                          )
                        ) : (
                          <span style={{ fontSize: '10px', fontWeight: 700, color: '#059669', background: 'rgba(5, 150, 105, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                            COMPLIANT ({workerWeekClaims.length} Daily Claims)
                          </span>
                        )}
                      </div>
                    </div>

                    <div>
                      {isAutoSuspended && (
                        isSeedAdmin ? (
                          <button
                            onClick={() => handleUnsuspendWorker(w.id)}
                            style={{
                              background: '#059669',
                              color: '#fff',
                              border: 'none',
                              padding: '6px 12px',
                              borderRadius: '8px',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: 'pointer'
                            }}
                          >
                            Unsuspend (Seed)
                          </button>
                        ) : (
                          <span style={{ fontSize: '10px', color: 'var(--text-dim)', textAlign: 'right', display: 'block', maxWidth: '100px' }}>
                            Seed Clearance Required
                          </span>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Rejection Modal */}
          {rejectionModal && (
            <div style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              zIndex: 100,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px'
            }}>
              <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: '16px',
                padding: '24px',
                maxWidth: '440px',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#ef4444' }}>
                    Reject Claim Submission
                  </h3>
                  <button onClick={() => setRejectionModal(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                    <X size={18} />
                  </button>
                </div>

                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                  Rejecting claim of <b>${parseFloat(rejectionModal.amount).toFixed(2)}</b> for <b>{rejectionModal.worker_email}</b> ({rejectionModal.day_of_week}).
                </p>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px' }}>
                    Reason for Rejection:
                  </label>
                  <textarea
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="e.g. Incomplete shift hours, missing performance quota, duplicate submission..."
                    rows={3}
                    style={{
                      width: '100%',
                      padding: '10px',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-main)',
                      color: 'var(--text-main)',
                      fontSize: '13px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button
                    onClick={() => setRejectionModal(null)}
                    style={{
                      background: 'none',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-muted)',
                      padding: '8px 14px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRejectClaim}
                    style={{
                      background: '#ef4444',
                      color: '#ffffff',
                      border: 'none',
                      padding: '8px 16px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 700,
                      cursor: 'pointer'
                    }}
                  >
                    Confirm Rejection
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Seed Admin Force-Claim Advance Modal */}
          {showSeedClaimModal && (
            <div style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.65)',
              zIndex: 100,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px'
            }}>
              <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: '20px',
                padding: '28px',
                maxWidth: '520px',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: '18px',
                boxShadow: '0 10px 40px rgba(0,0,0,0.3)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(5, 150, 105, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Zap size={20} color="#059669" />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: 'var(--text-main)' }}>
                        Seed Admin: Issue Worker Claim
                      </h3>
                      <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--text-muted)' }}>
                        Claim even <b>future days</b> for a worker. The system records it as an approved claim for that week.
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setShowSeedClaimModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                    <X size={18} />
                  </button>
                </div>

                <form onSubmit={handleSeedCreateClaim} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* Field 1: Target Worker */}
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '5px' }}>
                      Select Worker:
                    </label>
                    <select
                      value={seedTargetWorkerId}
                      onChange={(e) => {
                        setSeedTargetWorkerId(e.target.value);
                        const sel = workers.find(w => w.id === e.target.value);
                        if (sel) {
                          const pType = sel.claim_criteria || 'daily_10';
                          setSeedPlanType(pType);
                          setSeedClaimAmount(pType === 'weekly_40' ? '40.00' : '10.00');
                        }
                      }}
                      required
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-main)',
                        color: 'var(--text-main)',
                        fontSize: '13px',
                        fontWeight: 600
                      }}
                    >
                      <option value="">-- Choose Worker --</option>
                      {workers.filter(w => w.role === 'worker').map(w => (
                        <option key={w.id} value={w.id}>
                          {w.email} ({w.claim_criteria === 'weekly_40' ? 'Weekly $40' : 'Daily $10'})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Field 2: Target Week */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '5px' }}>
                        Target Week Cycle:
                      </label>
                      <select
                        value={seedTargetWeek}
                        onChange={(e) => setSeedTargetWeek(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '9px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-main)',
                          color: 'var(--text-main)',
                          fontSize: '13px',
                          fontWeight: 600
                        }}
                      >
                        {weekList.map(w => (
                          <option key={w} value={w}>{w}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '5px' }}>
                        Plan Type:
                      </label>
                      <select
                        value={seedPlanType}
                        onChange={(e) => {
                          setSeedPlanType(e.target.value);
                          setSeedClaimAmount(e.target.value === 'weekly_40' ? '40.00' : '10.00');
                        }}
                        style={{
                          width: '100%',
                          padding: '9px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-main)',
                          color: 'var(--text-main)',
                          fontSize: '13px',
                          fontWeight: 600
                        }}
                      >
                        <option value="daily_10">Daily $10 Plan</option>
                        <option value="weekly_40">Weekly $40 Plan</option>
                      </select>
                    </div>
                  </div>

                  {/* Field 3: Day Selector (Supports Future Days) */}
                  {seedPlanType === 'daily_10' && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                        <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)' }}>
                          Claim Day (Past, Current, or Future):
                        </label>
                        <span style={{ fontSize: '11px', color: '#059669', fontWeight: 700 }}>
                          Date: {getDateForDayInWeek(seedTargetWeek, seedTargetDay)}
                          {getDateForDayInWeek(seedTargetWeek, seedTargetDay) > getTodayDateString() && ' (Future Day)'}
                        </span>
                      </div>
                      <select
                        value={seedTargetDay}
                        onChange={(e) => setSeedTargetDay(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '9px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-main)',
                          color: 'var(--text-main)',
                          fontSize: '13px',
                          fontWeight: 600
                        }}
                      >
                        {DAYS_OF_WEEK.map(d => {
                          const dateStr = getDateForDayInWeek(seedTargetWeek, d);
                          const isFuture = dateStr > getTodayDateString();
                          return (
                            <option key={d} value={d}>
                              {d} — {dateStr} {isFuture ? '★ Future Day' : ''}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}

                  {/* Field 4: Amount */}
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '5px' }}>
                      Claim Amount ($ USD):
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={seedClaimAmount}
                      onChange={(e) => setSeedClaimAmount(e.target.value)}
                      required
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-main)',
                        color: 'var(--text-main)',
                        fontSize: '13px',
                        fontWeight: 700,
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>

                  {/* Field 5: Notes */}
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '5px' }}>
                      Authorization Reason / Notes:
                    </label>
                    <input
                      type="text"
                      value={seedAdminNotes}
                      onChange={(e) => setSeedAdminNotes(e.target.value)}
                      placeholder="e.g. Advance shift approval by Seed Owner"
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-main)',
                        color: 'var(--text-main)',
                        fontSize: '13px',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                    <button
                      type="button"
                      onClick={() => setShowSeedClaimModal(false)}
                      disabled={seedSubmitting}
                      style={{
                        background: 'none',
                        border: '1px solid var(--border-color)',
                        color: 'var(--text-muted)',
                        padding: '8px 16px',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={seedSubmitting}
                      style={{
                        background: 'linear-gradient(135deg, #059669, #10b981)',
                        color: '#ffffff',
                        border: 'none',
                        padding: '9px 18px',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: 700,
                        cursor: seedSubmitting ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <Check size={14} />
                      {seedSubmitting ? 'Issuing...' : 'Issue & Record Claim (Seed)'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Admin Direct Notification Modal */}
          {showSendNotifModal && (
            <div style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.65)',
              zIndex: 100,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px'
            }}>
              <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: '20px',
                padding: '28px',
                maxWidth: '480px',
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                boxShadow: '0 10px 40px rgba(0,0,0,0.3)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(59, 130, 246, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Bell size={20} color="#3b82f6" />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: 'var(--text-main)' }}>
                        Send Worker Notice
                      </h3>
                      <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--text-muted)' }}>
                        Plays a ding chime sound on the worker's dashboard and delivers to their notification bar.
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setShowSendNotifModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                    <X size={18} />
                  </button>
                </div>

                <form onSubmit={handleAdminSendNotification} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '5px' }}>
                      Target Recipient:
                    </label>
                    <select
                      value={notifTargetWorkerId}
                      onChange={(e) => setNotifTargetWorkerId(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-main)',
                        color: 'var(--text-main)',
                        fontSize: '13px',
                        fontWeight: 600
                      }}
                    >
                      <option value="ALL">All Active Workers ({workers.filter(w => w.role === 'worker').length} users)</option>
                      {workers.filter(w => w.role === 'worker').map(w => (
                        <option key={w.id} value={w.id}>{w.email}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '5px' }}>
                      Notice Type / Urgency:
                    </label>
                    <select
                      value={notifType}
                      onChange={(e) => setNotifType(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-main)',
                        color: 'var(--text-main)',
                        fontSize: '13px',
                        fontWeight: 600
                      }}
                    >
                      <option value="info">General Announcement (Blue Info)</option>
                      <option value="target_warning">Urgent Target Warning (Red Warning)</option>
                      <option value="target_reminder">Weekly Target Reminder (Amber Reminder)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '5px' }}>
                      Notification Title:
                    </label>
                    <input
                      type="text"
                      value={notifTitle}
                      onChange={(e) => setNotifTitle(e.target.value)}
                      placeholder="e.g. Urgent: Weekly Target Default Warning"
                      required
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-main)',
                        color: 'var(--text-main)',
                        fontSize: '13px',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '5px' }}>
                      Notification Message:
                    </label>
                    <textarea
                      rows={4}
                      value={notifMessage}
                      onChange={(e) => setNotifMessage(e.target.value)}
                      placeholder="Describe target rules, remaining balance, or consequences of default..."
                      required
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-main)',
                        color: 'var(--text-main)',
                        fontSize: '13px',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                    <button
                      type="button"
                      onClick={() => setShowSendNotifModal(false)}
                      disabled={sendingNotif}
                      style={{
                        background: 'none',
                        border: '1px solid var(--border-color)',
                        color: 'var(--text-muted)',
                        padding: '8px 16px',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={sendingNotif}
                      style={{
                        background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
                        color: '#ffffff',
                        border: 'none',
                        padding: '9px 18px',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: 700,
                        cursor: sendingNotif ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <Send size={14} />
                      {sendingNotif ? 'Sending...' : 'Dispatch Alert'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

        </div>
      )}
    </DashboardLayout>
  );
}
