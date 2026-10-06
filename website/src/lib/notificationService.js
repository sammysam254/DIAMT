import { supabase } from './supabase';
import { playDingSound } from './soundEffects';
import { getISOWeekString, getTodayDateString, getCurrentDayName } from './weekUtils';

// ══════════════════════════════════════════════════════════════════════════════
// DIAMT NOTIFICATION ENGINE — REALTIME ALERTS, CHIMES & DAILY 4X COMPLIANCE AUDIT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Send an in-app notification to any user
 */
export async function sendNotificationToUser({
  userId,
  userEmail,
  title,
  message,
  type = 'info',
  metadata = {}
}) {
  try {
    const { data, error } = await supabase
      .from('user_notifications')
      .insert([{
        user_id: userId,
        user_email: userEmail,
        title,
        message,
        type,
        metadata,
        is_read: false,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) {
      // If table does not exist yet in local testing, gracefully fallback
      console.warn('Notification insert note:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Failed to send in-app notification:', err);
    return null;
  }
}

/**
 * Broadcast claim approval, rejection, or seed dispatch notification
 */
export async function notifyClaimAction({
  workerId,
  workerEmail,
  action, // 'approved' | 'rejected' | 'seed_issued'
  amount,
  dayOrWeek,
  weekIdentifier,
  reason = '',
  approverEmail = ''
}) {
  const amtStr = `$${parseFloat(amount || 0).toFixed(2)}`;
  let title = '';
  let message = '';
  let type = 'info';

  if (action === 'approved') {
    title = `Claim Approved (${amtStr} USD)`;
    message = `Your ${dayOrWeek} claim of ${amtStr} for week ${weekIdentifier} has been verified and permanently registered by ${approverEmail || 'Admin'}. No further action is required.`;
    type = 'claim_approved';
  } else if (action === 'rejected') {
    title = `Claim Rejected (${amtStr} USD)`;
    message = `Your ${dayOrWeek} claim for week ${weekIdentifier} was rejected. Reason: ${reason || 'Administrative review requirement unmet'}. Please check your claim requirements.`;
    type = 'claim_rejected';
  } else if (action === 'seed_issued') {
    title = `⚡ Seed Admin Claim Issued (${amtStr} USD)`;
    message = `The Seed Owner pre-authorized and approved your claim for ${dayOrWeek} (${weekIdentifier}). It has been registered to your weekly record.`;
    type = 'claim_issued';
  }

  return sendNotificationToUser({
    userId: workerId,
    userEmail: workerEmail,
    title,
    message,
    type,
    metadata: { weekIdentifier, dayOrWeek, amount }
  });
}

/**
 * Evaluates current worker compliance status and triggers the 4 daily notifications
 * Slots:
 *   1. Morning Kickoff (06:00 - 10:59)
 *   2. Mid-Day Target Check (11:00 - 15:59)
 *   3. Evening Compliance Alert (16:00 - 20:59)
 *   4. Night Urgent Audit Warning (21:00 - 05:59)
 */
export async function checkAndTriggerDailyTargetReminders(workerProfile) {
  if (!workerProfile || workerProfile.role !== 'worker') return;
  if (workerProfile.is_auto_suspended || workerProfile.is_blocked) return;

  const currentHour = new Date().getHours();
  const todayDate = getTodayDateString();
  const weekId = getISOWeekString();
  const dayName = getCurrentDayName();

  let slot = '';
  let slotLabel = '';
  if (currentHour >= 6 && currentHour < 11) {
    slot = 'slot_1_morning';
    slotLabel = 'Morning Performance Brief';
  } else if (currentHour >= 11 && currentHour < 16) {
    slot = 'slot_2_midday';
    slotLabel = 'Mid-Day Target Check';
  } else if (currentHour >= 16 && currentHour < 21) {
    slot = 'slot_3_evening';
    slotLabel = 'Evening Compliance Status';
  } else {
    slot = 'slot_4_night';
    slotLabel = 'Final Night Target Warning';
  }

  // Prevent duplicate execution for this slot today
  const storageKey = `diamt_daily_reminder_${workerProfile.id}_${todayDate}_${slot}`;
  if (localStorage.getItem(storageKey)) {
    return;
  }

  try {
    // Query worker's claims for current week
    const { data: claims } = await supabase
      .from('worker_claims')
      .select('*')
      .eq('worker_id', workerProfile.id)
      .eq('week_identifier', weekId);

    const userClaims = claims || [];
    const isWeeklyPlan = workerProfile.claim_criteria === 'weekly_40';
    const hasWeeklySent = userClaims.some(c => c.plan_type === 'weekly_40' || parseFloat(c.amount) >= 40);
    const approvedTotal = userClaims
      .filter(c => c.status === 'approved')
      .reduce((acc, c) => acc + (parseFloat(c.amount) || 0), 0);
    const hasClaimedToday = userClaims.some(c => c.claim_date === todayDate);

    let title = `${slotLabel} — Week ${weekId}`;
    let message = '';
    let type = 'target_reminder';

    if (isWeeklyPlan) {
      if (hasWeeklySent) {
        title = `✓ Weekly Target Met — ${slotLabel}`;
        message = `Good news! Your weekly $40.00 USD claim for week ${weekId} has already been submitted and recorded. Your account is in full compliance with the weekly target rule.`;
        type = 'target_reminder';
      } else {
        title = `⚠ ACTION REQUIRED: Weekly $40 Claim Needed (${slotLabel})`;
        message = `Current Status: You are on the Weekly $40 Plan and have NOT yet sent your weekly $40 claim for week ${weekId}. You may send it any day this week, but it must be submitted before Sunday. CONSEQUENCE: Failure to submit will result in immediate automatic account suspension and you will be required to leave the station before tomorrow at 8:00 AM.`;
        type = 'target_warning';
      }
    } else {
      // Daily $10 plan
      const dailyRemaining = Math.max(0, 50 - approvedTotal);
      if (hasClaimedToday) {
        title = `✓ Daily Claim Submitted — ${slotLabel}`;
        message = `Today's claim for ${dayName} is recorded. Total approved this week: $${approvedTotal.toFixed(2)}. Maintain your daily claims to meet weekly operational targets.`;
      } else {
        title = `⚠ Daily Target Notice — ${slotLabel}`;
        message = `You have not yet submitted your daily $10.00 claim for today (${dayName}). Weekly approved total: $${approvedTotal.toFixed(2)}. Make sure to submit your claims to avoid failing weekly compliance rules.`;
        type = 'target_warning';
      }
    }

    // Insert notification
    await sendNotificationToUser({
      userId: workerProfile.id,
      userEmail: workerProfile.email,
      title,
      message,
      type,
      metadata: { weekId, slot, date: todayDate }
    });

    // Mark slot completed
    localStorage.setItem(storageKey, 'true');

    // Play ding chime
    playDingSound();
  } catch (e) {
    console.error('Error during daily reminder check:', e);
  }
}
