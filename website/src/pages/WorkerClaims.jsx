import React, { useEffect, useState } from 'react';
import DashboardLayout from '../layouts/DashboardLayout';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { 
  FileText, CheckCircle2, Clock, XCircle, Download, Calendar, 
  DollarSign, ShieldCheck, AlertCircle, RefreshCw, Send, Award,
  ArrowRightLeft, AlertTriangle, Check
} from 'lucide-react';
import SEO from '../components/SEO';
import DiamtLoader from '../components/DiamtLoader';
import { generateWeeklyWorkerClaimsPdf } from '../lib/pdfGenerator';
import { 
  getISOWeekString, getRecentWeekIdentifiers, DAYS_OF_WEEK, 
  getCurrentDayName, getTodayDateString 
} from '../lib/weekUtils';

export default function WorkerClaims() {
  const { profile } = useAuth();
  const [selectedWeek, setSelectedWeek] = useState(getISOWeekString());
  const [weekList, setWeekList] = useState([]);
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [switchingPlan, setSwitchingPlan] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);
  const [showPlanModal, setShowPlanModal] = useState(false);

  const currentWeek = getISOWeekString();
  const currentDay = getCurrentDayName();
  const todayDate = getTodayDateString();

  const planType = profile?.claim_criteria === 'weekly_40' ? 'weekly_40' : 'daily_10';
  const planRate = planType === 'weekly_40' ? 40.00 : 10.00;

  useEffect(() => {
    setWeekList(getRecentWeekIdentifiers(10));
  }, []);

  const loadClaims = async (isInitial = false) => {
    if (!profile) return;
    if (isInitial) setLoading(true);

    try {
      const { data, error } = await supabase
        .from('worker_claims')
        .select('*')
        .eq('worker_id', profile.id)
        .eq('week_identifier', selectedWeek)
        .order('claim_date', { ascending: true });

      if (error) throw error;
      setClaims(data || []);
    } catch (err) {
      console.error('Error fetching worker claims:', err);
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    if (!profile) return;
    loadClaims(true);

    // Realtime listener for claims updates (instant approval reflection)
    const channel = supabase
      .channel(`worker-claims-${profile.id}-${selectedWeek}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'worker_claims',
        filter: `worker_id=eq.${profile.id}`,
      }, () => {
        loadClaims(false);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile, selectedWeek]);

  // Check claim states for current week
  const hasClaimedToday = claims.some(c => c.day_of_week === currentDay || c.claim_date === todayDate);
  const weeklyClaim = claims.find(c => c.plan_type === 'weekly_40');
  const hasWeeklyClaim = Boolean(weeklyClaim);

  // Submit Claim (Daily $10 or Weekly $40 on any day)
  const handleMakeClaim = async (dayToClaim = currentDay) => {
    if (!profile) return;
    setSubmitting(true);
    setActionMsg(null);

    try {
      const isWeekly = planType === 'weekly_40';
      const dayVal = isWeekly ? 'Weekly' : dayToClaim;

      const newClaim = {
        worker_id: profile.id,
        worker_email: profile.email,
        week_identifier: selectedWeek,
        day_of_week: dayVal,
        claim_date: todayDate,
        amount: planRate,
        plan_type: planType,
        status: 'pending',
        notes: isWeekly ? `Weekly $40 claim submitted on ${currentDay} (${todayDate})` : null,
        claimed_at: new Date().toISOString()
      };

      const { error } = await supabase.from('worker_claims').insert([newClaim]);

      if (error) {
        if (error.code === '23505') {
          throw new Error('A claim for this cycle has already been submitted.');
        }
        throw error;
      }

      setActionMsg({ 
        type: 'success', 
        text: isWeekly 
          ? `Weekly $40.00 USD claim successfully submitted! Your weekly target is recorded for administrative approval.` 
          : `Claim for ${dayVal} ($${planRate.toFixed(2)}) submitted successfully for administrative review!` 
      });
      await loadClaims(false);
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message || 'Failed to submit claim.' });
    } finally {
      setSubmitting(false);
    }
  };

  // Plan Switch with Instant Admin Auto-Approval
  const handleSwitchPlan = async (newPlan) => {
    if (!profile || newPlan === planType) return;
    setSwitchingPlan(true);
    setActionMsg(null);

    try {
      const planLabel = newPlan === 'weekly_40' ? 'Weekly $40 Plan' : 'Daily $10 Plan';

      const { error } = await supabase
        .from('profiles')
        .update({
          claim_criteria: newPlan,
          pending_claim_criteria: null,
          criteria_requested_at: new Date().toISOString(),
          criteria_change_reason: `Worker switched to ${planLabel} (System auto-approved by admin policy)`
        })
        .eq('id', profile.id);

      if (error) throw error;

      setShowPlanModal(false);
      setActionMsg({
        type: 'success',
        text: `Plan successfully updated to ${planLabel}! Auto-approved by administrator.`
      });
    } catch (err) {
      setActionMsg({ type: 'error', text: 'Error changing plan: ' + err.message });
    } finally {
      setSwitchingPlan(false);
    }
  };

  const handleDownloadPdf = () => {
    if (!profile) return;
    generateWeeklyWorkerClaimsPdf({
      worker: profile,
      weekIdentifier: selectedWeek,
      claims: claims
    });
  };

  const totalSubmitted = claims.reduce((acc, c) => acc + (parseFloat(c.amount) || 0), 0);
  const approvedClaims = claims.filter(c => c.status === 'approved');
  const totalApproved = approvedClaims.reduce((acc, c) => acc + (parseFloat(c.amount) || 0), 0);
  const pendingCount = claims.filter(c => c.status === 'pending').length;

  return (
    <DashboardLayout>
      <SEO 
        title="Worker Claims & Records | DIAMT Cloud" 
        description="Submit daily and weekly claims, track administrative approvals, and export executive green-theme audit records." 
      />

      {loading ? (
        <DiamtLoader 
          fullScreen={false} 
          text="SYNCHRONIZING CLAIMS LEDGER" 
          subtext="Querying immutable claim records and verification state..." 
        />
      ) : (
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Header Card */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '18px',
            padding: '24px',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '16px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.05)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{
                width: '52px',
                height: '52px',
                borderRadius: '14px',
                background: 'linear-gradient(135deg, #059669, #10b981)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 16px rgba(5, 150, 105, 0.25)'
              }}>
                <DollarSign size={28} color="#ffffff" />
              </div>
              <div>
                <h1 style={{ fontSize: '22px', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                  Worker Claims & Performance
                </h1>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                  Submit work claims according to your subscribed criteria. Once approved by administration, claims are permanently finalized.
                </p>
              </div>
            </div>

            {/* Week Selector, Plan Change & PDF Action */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              
              <button
                onClick={() => setShowPlanModal(true)}
                style={{
                  background: 'rgba(5, 150, 105, 0.12)',
                  color: '#059669',
                  border: '1px solid rgba(5, 150, 105, 0.3)',
                  padding: '9px 14px',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer'
                }}
              >
                <ArrowRightLeft size={15} />
                Change Plan (Auto-Approved)
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-main)', padding: '6px 12px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                <Calendar size={16} color="var(--primary)" />
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>Week:</span>
                <select
                  value={selectedWeek}
                  onChange={(e) => setSelectedWeek(e.target.value)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-main)',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    outline: 'none'
                  }}
                >
                  {weekList.map(w => (
                    <option key={w} value={w} style={{ background: 'var(--bg-card)', color: 'var(--text-main)' }}>
                      {w} {w === currentWeek ? '(Current)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleDownloadPdf}
                style={{
                  background: 'linear-gradient(135deg, #064e3b, #059669)',
                  color: '#ffffff',
                  border: 'none',
                  padding: '9px 16px',
                  borderRadius: '10px',
                  fontSize: '13px',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(5, 150, 105, 0.2)'
                }}
              >
                <Download size={16} />
                Download PDF Record (Green Theme)
              </button>
            </div>
          </div>

          {/* Feedback banner */}
          {actionMsg && (
            <div style={{
              background: actionMsg.type === 'success' ? 'rgba(5, 150, 105, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${actionMsg.type === 'success' ? '#059669' : '#ef4444'}`,
              borderRadius: '12px',
              padding: '12px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontSize: '13px',
              fontWeight: 600,
              color: actionMsg.type === 'success' ? '#059669' : '#ef4444'
            }}>
              {actionMsg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
              {actionMsg.text}
            </div>
          )}

          {/* Weekly Plan Rule Banner (Explaining any-day $40 submission & auto-suspension warning) */}
          {planType === 'weekly_40' && (
            <div style={{
              background: hasWeeklyClaim ? 'rgba(5, 150, 105, 0.08)' : 'rgba(217, 119, 6, 0.08)',
              border: `1px solid ${hasWeeklyClaim ? '#059669' : '#d97706'}`,
              borderRadius: '14px',
              padding: '16px 20px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '14px'
            }}>
              {hasWeeklyClaim ? (
                <ShieldCheck size={24} color="#059669" style={{ flexShrink: 0, marginTop: '2px' }} />
              ) : (
                <AlertTriangle size={24} color="#d97706" style={{ flexShrink: 0, marginTop: '2px' }} />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 800, color: hasWeeklyClaim ? '#059669' : '#d97706' }}>
                  {hasWeeklyClaim 
                    ? `WEEKLY $40.00 USD TARGET CLAIM RECORDED FOR WEEK ${selectedWeek}` 
                    : `WEEKLY PLAN TARGET RULE: SUBMIT $40.00 USD CLAIM THIS WEEK`}
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-main)', lineHeight: '1.5' }}>
                  {hasWeeklyClaim ? (
                    <span>
                      Your weekly $40.00 USD claim was submitted on <b>{weeklyClaim.claim_date}</b>. Status: <b>{(weeklyClaim.status || '').toUpperCase()}</b>. No further submissions are required for this week cycle.
                    </span>
                  ) : (
                    <span>
                      As a subscriber to the Weekly Plan, you can send your <b>$40.00 USD</b> claim on <b>any day within this current week</b>. 
                      You must submit it before the week concludes; failure to submit will result in <b>automatic account suspension by the system</b>.
                    </span>
                  )}
                </p>
              </div>

              {!hasWeeklyClaim && selectedWeek === currentWeek && (
                <button
                  onClick={() => handleMakeClaim('Weekly')}
                  disabled={submitting}
                  style={{
                    background: 'linear-gradient(135deg, #059669, #10b981)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '10px 18px',
                    borderRadius: '10px',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 4px 14px rgba(5, 150, 105, 0.3)'
                  }}
                >
                  <Send size={15} />
                  {submitting ? 'Submitting...' : 'Send $40 Weekly Claim Now'}
                </button>
              )}
            </div>
          )}

          {/* KPI Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            
            {/* Card 1: Plan & Rate */}
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '16px',
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-muted)', fontWeight: 700 }}>
                  Active Plan
                </span>
                <Award size={16} color="#059669" />
              </div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-main)' }}>
                {planType === 'weekly_40' ? 'Weekly $40 Plan' : 'Daily $10 Plan'}
              </div>
              <span style={{ fontSize: '12px', color: '#059669', fontWeight: 600 }}>
                {planType === 'weekly_40' 
                  ? 'Send $40 any day in the week' 
                  : '$10.00 per eligible day'}
              </span>
            </div>

            {/* Card 2: Total Claimed */}
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '16px',
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-muted)', fontWeight: 700 }}>
                  Total Submitted
                </span>
                <Clock size={16} color="var(--primary)" />
              </div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-main)' }}>
                ${totalSubmitted.toFixed(2)}
              </div>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {claims.length} claim(s) recorded this week
              </span>
            </div>

            {/* Card 3: Approved Total */}
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '16px',
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-muted)', fontWeight: 700 }}>
                  Approved & Finalized
                </span>
                <CheckCircle2 size={16} color="#059669" />
              </div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#059669' }}>
                ${totalApproved.toFixed(2)}
              </div>
              <span style={{ fontSize: '12px', color: '#059669', fontWeight: 600 }}>
                {approvedClaims.length} approved by admin (Final)
              </span>
            </div>

            {/* Card 4: Pending Review */}
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: '16px',
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-muted)', fontWeight: 700 }}>
                  Pending Verification
                </span>
                <Clock size={16} color="#d97706" />
              </div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: '#d97706' }}>
                {pendingCount}
              </div>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Awaiting administrator sign-off
              </span>
            </div>
          </div>

          {/* Claim Submission Section */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '18px',
            padding: '24px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                  Weekly Claim Schedule ({selectedWeek})
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                  {planType === 'weekly_40' 
                    ? 'Weekly $40 Plan: Send one $40 USD claim at any time during this week.' 
                    : 'Daily $10 Plan: Submit claims for days worked. Approved claims are permanently registered.'}
                </p>
              </div>

              {selectedWeek === currentWeek && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {planType === 'weekly_40' ? (
                    <button
                      onClick={() => handleMakeClaim('Weekly')}
                      disabled={submitting || hasWeeklyClaim}
                      style={{
                        background: hasWeeklyClaim ? 'var(--border-color)' : 'linear-gradient(135deg, #059669, #10b981)',
                        color: hasWeeklyClaim ? 'var(--text-muted)' : '#ffffff',
                        border: 'none',
                        padding: '10px 20px',
                        borderRadius: '10px',
                        fontSize: '13px',
                        fontWeight: 700,
                        cursor: (hasWeeklyClaim || submitting) ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        boxShadow: hasWeeklyClaim ? 'none' : '0 4px 14px rgba(5, 150, 105, 0.3)'
                      }}
                    >
                      <Send size={15} />
                      {submitting 
                        ? 'Submitting...' 
                        : hasWeeklyClaim 
                          ? 'Weekly $40 Claim Submitted' 
                          : 'Send Weekly $40 Claim (Any Day This Week)'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleMakeClaim(currentDay)}
                      disabled={submitting || hasClaimedToday}
                      style={{
                        background: hasClaimedToday ? 'var(--border-color)' : 'linear-gradient(135deg, #059669, #10b981)',
                        color: hasClaimedToday ? 'var(--text-muted)' : '#ffffff',
                        border: 'none',
                        padding: '10px 20px',
                        borderRadius: '10px',
                        fontSize: '13px',
                        fontWeight: 700,
                        cursor: (hasClaimedToday || submitting) ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        boxShadow: hasClaimedToday ? 'none' : '0 4px 14px rgba(5, 150, 105, 0.3)'
                      }}
                    >
                      <Send size={15} />
                      {submitting 
                        ? 'Submitting...' 
                        : hasClaimedToday 
                          ? 'Claim Submitted for Today' 
                          : `Submit Today's Claim ($10.00)`}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Days Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px' }}>
              {DAYS_OF_WEEK.map((day) => {
                const dayClaim = claims.find(c => c.day_of_week === day);
                const isWeeklyActive = planType === 'weekly_40';
                const isToday = day === currentDay && selectedWeek === currentWeek;

                let statusBadge = (
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'var(--bg-main)', padding: '4px 8px', borderRadius: '6px' }}>
                    {isWeeklyActive ? (hasWeeklyClaim ? 'Covered' : 'Eligible') : 'Unclaimed'}
                  </span>
                );

                if (dayClaim) {
                  if (dayClaim.status === 'approved') {
                    statusBadge = (
                      <span style={{ fontSize: '11px', color: '#059669', background: 'rgba(5, 150, 105, 0.1)', padding: '4px 8px', borderRadius: '6px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <CheckCircle2 size={12} /> Approved
                      </span>
                    );
                  } else if (dayClaim.status === 'rejected') {
                    statusBadge = (
                      <span style={{ fontSize: '11px', color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '4px 8px', borderRadius: '6px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <XCircle size={12} /> Rejected
                      </span>
                    );
                  } else {
                    statusBadge = (
                      <span style={{ fontSize: '11px', color: '#d97706', background: 'rgba(217, 119, 6, 0.1)', padding: '4px 8px', borderRadius: '6px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={12} /> Pending
                      </span>
                    );
                  }
                } else if (isWeeklyActive && hasWeeklyClaim) {
                  statusBadge = (
                    <span style={{ fontSize: '11px', color: '#059669', background: 'rgba(5, 150, 105, 0.08)', padding: '4px 8px', borderRadius: '6px', fontWeight: 600 }}>
                      Weekly $40 Met
                    </span>
                  );
                }

                return (
                  <div 
                    key={day}
                    style={{
                      background: isToday ? 'rgba(5, 150, 105, 0.05)' : 'var(--bg-main)',
                      border: isToday ? '2px solid #059669' : '1px solid var(--border-color)',
                      borderRadius: '12px',
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      position: 'relative'
                    }}
                  >
                    {isToday && (
                      <span style={{
                        position: 'absolute',
                        top: '-8px',
                        right: '8px',
                        background: '#059669',
                        color: '#fff',
                        fontSize: '9px',
                        fontWeight: 800,
                        padding: '1px 6px',
                        borderRadius: '4px',
                        letterSpacing: '0.5px'
                      }}>
                        TODAY
                      </span>
                    )}

                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-main)' }}>
                      {day}
                    </div>

                    <div style={{ fontSize: '15px', fontWeight: 800, color: dayClaim ? 'var(--text-main)' : 'var(--text-dim)' }}>
                      {dayClaim ? `$${parseFloat(dayClaim.amount).toFixed(2)}` : (isWeeklyActive && hasWeeklyClaim ? 'Weekly' : '—')}
                    </div>

                    <div style={{ marginTop: 'auto' }}>
                      {statusBadge}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Claims History Table */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '18px',
            padding: '24px',
            overflowX: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 800, margin: 0, color: 'var(--text-main)' }}>
                Detailed Claims Audit Log ({selectedWeek})
              </h3>
              <button
                onClick={() => loadClaims(false)}
                style={{
                  background: 'none',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-muted)',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px'
                }}
              >
                <RefreshCw size={12} /> Refresh
              </button>
            </div>

            {claims.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: '13px' }}>
                <FileText size={36} color="var(--border-color)" style={{ margin: '0 auto 12px' }} />
                No claims recorded for this week. Use the button above to submit your eligible claim.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px' }}>Day / Scope</th>
                    <th style={{ padding: '12px' }}>Claim Date</th>
                    <th style={{ padding: '12px' }}>Plan Type</th>
                    <th style={{ padding: '12px' }}>Amount</th>
                    <th style={{ padding: '12px' }}>Status</th>
                    <th style={{ padding: '12px' }}>Admin Sign-Off</th>
                    <th style={{ padding: '12px' }}>Submission Time</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((claim) => (
                    <tr key={claim.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '12px', fontWeight: 700, color: 'var(--text-main)' }}>
                        {claim.day_of_week}
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
                            <CheckCircle2 size={12} /> APPROVED (FINAL)
                          </span>
                        )}
                        {claim.status === 'pending' && (
                          <span style={{ color: '#d97706', background: 'rgba(217, 119, 6, 0.1)', padding: '4px 10px', borderRadius: '6px', fontWeight: 700, fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <Clock size={12} /> PENDING REVIEW
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
                          <span>Verified by <b>{claim.approver_email}</b></span>
                        ) : claim.status === 'rejected' ? (
                          <span style={{ color: '#ef4444' }}>{claim.rejection_reason || 'Rejected by Admin'}</span>
                        ) : (
                          <span style={{ color: 'var(--text-dim)' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '12px', fontSize: '11px', color: 'var(--text-dim)' }}>
                        {new Date(claim.claimed_at).toLocaleDateString()} {new Date(claim.claimed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Plan Change Modal (Auto-Approved by Admin) */}
          {showPlanModal && (
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
                gap: '20px',
                boxShadow: '0 10px 40px rgba(0,0,0,0.3)'
              }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(5, 150, 105, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <ArrowRightLeft size={18} color="#059669" />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'var(--text-main)' }}>
                        Choose Subscribed Plan
                      </h3>
                      <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                        Plan requests are <b>automatically approved</b> by the system per administrator policy.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Plan Option 1: Daily $10 */}
                <div 
                  onClick={() => !switchingPlan && handleSwitchPlan('daily_10')}
                  style={{
                    border: planType === 'daily_10' ? '2px solid #059669' : '1px solid var(--border-color)',
                    background: planType === 'daily_10' ? 'rgba(5, 150, 105, 0.06)' : 'var(--bg-main)',
                    borderRadius: '14px',
                    padding: '16px',
                    cursor: switchingPlan ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-main)' }}>Daily $10 Plan</span>
                      {planType === 'daily_10' && (
                        <span style={{ fontSize: '10px', fontWeight: 800, background: '#059669', color: '#fff', padding: '2px 6px', borderRadius: '4px' }}>CURRENT ACTIVE</span>
                      )}
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                      Submit $10.00 USD claims for active shift days worked.
                    </p>
                  </div>
                  {planType === 'daily_10' && <Check size={20} color="#059669" />}
                </div>

                {/* Plan Option 2: Weekly $40 */}
                <div 
                  onClick={() => !switchingPlan && handleSwitchPlan('weekly_40')}
                  style={{
                    border: planType === 'weekly_40' ? '2px solid #059669' : '1px solid var(--border-color)',
                    background: planType === 'weekly_40' ? 'rgba(5, 150, 105, 0.06)' : 'var(--bg-main)',
                    borderRadius: '14px',
                    padding: '16px',
                    cursor: switchingPlan ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-main)' }}>Weekly $40 Plan</span>
                      {planType === 'weekly_40' && (
                        <span style={{ fontSize: '10px', fontWeight: 800, background: '#059669', color: '#fff', padding: '2px 6px', borderRadius: '4px' }}>CURRENT ACTIVE</span>
                      )}
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                      Send <b>one $40.00 USD claim on any day</b> within the active week cycle. Must be sent in the current week to avoid system auto-suspension.
                    </p>
                  </div>
                  {planType === 'weekly_40' && <Check size={20} color="#059669" />}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                  <button
                    onClick={() => setShowPlanModal(false)}
                    disabled={switchingPlan}
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
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </DashboardLayout>
  );
}
