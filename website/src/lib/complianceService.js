import { supabase } from './supabase';
import { getISOWeekString, getPreviousISOWeekString, isWeekCompleted } from './weekUtils';

/**
 * Calculates compliance metrics for a single worker for a given week.
 * Target: $40.00 in valid (approved or pending, not rejected) claims.
 */
export function calculateWorkerCompliance(worker, workerWeekClaims = []) {
  const validClaims = workerWeekClaims.filter(c => c.status !== 'rejected');
  const rejectedClaims = workerWeekClaims.filter(c => c.status === 'rejected');
  
  const totalValidAmount = validClaims.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
  const approvedAmount = validClaims
    .filter(c => c.status === 'approved')
    .reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
  const pendingAmount = validClaims
    .filter(c => c.status === 'pending')
    .reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);

  const targetAmount = 40.00;
  const isCompliant = totalValidAmount >= targetAmount;
  const remainingAmount = Math.max(0, targetAmount - totalValidAmount);

  return {
    isCompliant,
    totalValidAmount,
    approvedAmount,
    pendingAmount,
    targetAmount,
    remainingAmount,
    validClaimsCount: validClaims.length,
    rejectedClaimsCount: rejectedClaims.length,
    validClaims,
    rejectedClaims
  };
}

/**
 * Checks if a worker is exempt from suspensions (e.g. Admins, Seed Admins)
 */
export function isExemptFromSuspension(worker) {
  if (!worker) return true;
  if (['admin', 'super_admin', 'seed_admin'].includes(worker.role)) return true;
  if ((worker.email || '').toLowerCase() === 'sammyseth260@gmail.com') return true;
  return false;
}

/**
 * Executes a full compliance audit for a given week identifier.
 * Evaluates ALL workers (both Weekly $40 Plan and Daily $10 Plan).
 * A worker is compliant if their valid claims total >= $40.00.
 */
export async function executeWeeklyComplianceAudit(auditWeek, { enforce = true, supabaseClient = supabase } = {}) {
  if (!auditWeek) throw new Error('auditWeek is required');

  // 1. Fetch all worker profiles
  const { data: profiles, error: pErr } = await supabaseClient
    .from('profiles')
    .select('*')
    .order('email', { ascending: true });

  if (pErr) throw pErr;

  // 2. Fetch all claims for this week
  const { data: claims, error: cErr } = await supabaseClient
    .from('worker_claims')
    .select('*')
    .eq('week_identifier', auditWeek);

  if (cErr) throw cErr;

  const allWorkers = (profiles || []).filter(p => p.role === 'worker' && !isExemptFromSuspension(p));
  const weekClaims = claims || [];

  const defaultingWorkers = [];
  const compliantWorkers = [];
  const alreadyBlockedOrSuspended = [];

  for (const worker of allWorkers) {
    const isAlreadySuspended = worker.is_auto_suspended === true;
    const isAlreadyBlocked = worker.is_blocked === true;

    if (isAlreadySuspended || isAlreadyBlocked) {
      alreadyBlockedOrSuspended.push({
        worker,
        reason: worker.blocked_reason || (isAlreadySuspended ? 'Auto-Suspended' : 'Blocked')
      });
      continue;
    }

    const workerClaims = weekClaims.filter(c => c.worker_id === worker.id);
    const metrics = calculateWorkerCompliance(worker, workerClaims);

    if (metrics.isCompliant) {
      compliantWorkers.push({ worker, metrics });
    } else {
      defaultingWorkers.push({ worker, metrics });
    }
  }

  // 3. Enforce suspensions if requested
  const suspendedWorkers = [];
  if (enforce && defaultingWorkers.length > 0) {
    for (const item of defaultingWorkers) {
      const { worker, metrics } = item;
      const blockedReason = `Due to failing to achieve weekly target rule as per your subscribed plan (Submitted $${metrics.totalValidAmount.toFixed(2)} of $40.00 required for week ${auditWeek}), the system has auto-suspended you and you are required to leave the station before tomorrow at 8 AM, as your services are no longer needed.`;

      const { error: updErr } = await supabaseClient
        .from('profiles')
        .update({
          is_auto_suspended: true,
          is_blocked: true,
          auto_suspended_week: auditWeek,
          blocked_reason: blockedReason
        })
        .eq('id', worker.id);

      if (!updErr) {
        suspendedWorkers.push(worker);

        // Send in-app notification
        try {
          await supabaseClient.from('user_notifications').insert([{
            user_id: worker.id,
            user_email: worker.email,
            title: `SYSTEM AUDIT: Account Auto-Suspended (Target Default — Week ${auditWeek})`,
            message: `You have been automatically suspended for failing to achieve the weekly $40.00 requirement during week cycle ${auditWeek}. You submitted $${metrics.totalValidAmount.toFixed(2)} of $40.00 required. As per platform policy, you are required to leave the station before tomorrow at 8:00 AM.`,
            type: 'target_warning',
            metadata: {
              weekIdentifier: auditWeek,
              totalSubmitted: metrics.totalValidAmount,
              targetRequired: 40.00
            }
          }]);
        } catch (_) {}
      }
    }
  }

  return {
    auditWeek,
    totalEvaluated: allWorkers.length,
    defaultingCount: defaultingWorkers.length,
    compliantCount: compliantWorkers.length,
    suspendedCount: suspendedWorkers.length,
    defaultingWorkers,
    compliantWorkers,
    alreadyBlockedOrSuspended
  };
}

/**
 * Automated runtime check:
 * Runs when users interact with the app. If the previous week ended (past Sunday 23:59),
 * automatically sweeps and enforces auto-suspensions for the concluded week cycle.
 */
export async function autoCheckAndEnforcePastWeekAudit(currentProfile) {
  if (!currentProfile) return null;

  const previousWeek = getPreviousISOWeekString();
  const currentWeek = getISOWeekString();

  // If previousWeek is the same as currentWeek, no past week to audit yet
  if (previousWeek === currentWeek) return null;

  // Case 1: Individual worker login enforcement
  // If the logged-in user is a worker, verify their compliance for the completed week
  if (currentProfile.role === 'worker' && !isExemptFromSuspension(currentProfile)) {
    if (!currentProfile.is_auto_suspended && !currentProfile.is_blocked) {
      try {
        const { data: prevClaims } = await supabase
          .from('worker_claims')
          .select('*')
          .eq('worker_id', currentProfile.id)
          .eq('week_identifier', previousWeek);

        const metrics = calculateWorkerCompliance(currentProfile, prevClaims || []);
        if (!metrics.isCompliant) {
          // Worker failed previous week target! Enforce immediate auto-suspension!
          const blockedReason = `Due to failing to achieve weekly target rule as per your subscribed plan (Submitted $${metrics.totalValidAmount.toFixed(2)} of $40.00 required for week ${previousWeek}), the system has auto-suspended you and you are required to leave the station before tomorrow at 8 AM, as your services are no longer needed.`;
          
          await supabase
            .from('profiles')
            .update({
              is_auto_suspended: true,
              is_blocked: true,
              auto_suspended_week: previousWeek,
              blocked_reason: blockedReason
            })
            .eq('id', currentProfile.id);

          return { suspended: true, workerId: currentProfile.id, week: previousWeek };
        }
      } catch (err) {
        console.error('[complianceService] Error checking worker past week compliance:', err);
      }
    }
    return null;
  }

  // Case 2: Admin / Seed Admin login enforcement
  // Automatically audit the concluded week in the background if not done recently
  const isAdmin = ['admin', 'super_admin', 'seed_admin'].includes(currentProfile.role) ||
                  currentProfile.email?.toLowerCase() === 'sammyseth260@gmail.com';

  if (isAdmin) {
    const lockKey = `diamt_audit_last_enforced_${previousWeek}`;
    const lastRun = localStorage.getItem(lockKey);
    // Re-check once every 30 minutes or on initial load
    if (lastRun && Date.now() - parseInt(lastRun, 10) < 30 * 60 * 1000) {
      return null;
    }

    try {
      const result = await executeWeeklyComplianceAudit(previousWeek, { enforce: true });
      localStorage.setItem(lockKey, String(Date.now()));
      return result;
    } catch (err) {
      console.error('[complianceService] Error in admin background audit enforcement:', err);
    }
  }

  return null;
}
