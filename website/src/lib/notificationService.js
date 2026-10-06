import { supabase } from './supabase';
import { playDingSound } from './soundEffects';
import { getISOWeekString, getTodayDateString, getCurrentDayName } from './weekUtils';

// ══════════════════════════════════════════════════════════════════════════════
// DIAMT NOTIFICATION ENGINE — REALTIME ALERTS, CHIMES & DAILY 4X COMPLIANCE AUDIT
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Send an in-app notification to a single user
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
      console.warn('[notificationService] Notification insert error:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Failed to send in-app notification:', err);
    return null;
  }
}

/**
 * Batch insert notifications to multiple users in a single atomic database query
 */
export async function sendNotificationToMultipleUsers(usersList, {
  title,
  message,
  type = 'info',
  metadata = {}
}) {
  if (!usersList || usersList.length === 0) return [];
  try {
    const rows = usersList.map(u => ({
      user_id: u.id,
      user_email: u.email,
      title,
      message,
      type,
      metadata,
      is_read: false,
      created_at: new Date().toISOString()
    }));

    const { data, error } = await supabase
      .from('user_notifications')
      .insert(rows)
      .select();

    if (error) {
      console.warn('[notificationService] Batch notification insert error:', error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('Failed to batch send in-app notifications:', err);
    return [];
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
    message = `Your ${dayOrWeek} claim of ${amtStr} for week ${weekIdentifier} has been verified and permanently registered by ${approverEmail || 'Admin'}. No further action is required for this claim.`;
    type = 'claim_approved';
  } else if (action === 'rejected') {
    title = `Claim Rejected (${amtStr} USD)`;
    message = `Your ${dayOrWeek} claim for week ${weekIdentifier} was rejected by ${approverEmail || 'Admin'}. Reason: ${reason || 'Administrative review requirement unmet'}. Please review your submissions or contact your supervisor.`;
    type = 'claim_rejected';
  } else if (action === 'seed_issued') {
    title = `⚡ Seed Admin Claim Issued (${amtStr} USD)`;
    message = `The Seed Owner pre-authorized and approved your claim for ${dayOrWeek} (${weekIdentifier}) in the amount of ${amtStr}. It has been credited to your weekly record.`;
    type = 'claim_issued';
  }

  return sendNotificationToUser({
    userId: workerId,
    userEmail: workerEmail,
    title,
    message,
    type,
    metadata: { weekIdentifier, dayOrWeek, amount, action }
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
  if (!workerProfile || !workerProfile.id) return;
  // Don't spam suspended workers
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

  // Prevent duplicate execution for this slot today in client storage
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
    const isWeeklyPlan = workerProfile.claims_plan === 'weekly' || workerProfile.claim_criteria === 'weekly_40';
    const approvedTotal = userClaims
      .filter(c => c.status === 'approved')
      .reduce((acc, c) => acc + (parseFloat(c.amount) || 0), 0);
    const pendingTotal = userClaims
      .filter(c => c.status === 'pending')
      .reduce((acc, c) => acc + (parseFloat(c.amount) || 0), 0);
    const targetAmount = 40.00;
    const remainingTarget = Math.max(0, targetAmount - approvedTotal);
    const hasFulfilled = approvedTotal >= targetAmount;

    let title = `${slotLabel} — Week ${weekId}`;
    let message = '';
    let type = 'target_reminder';

    if (hasFulfilled) {
      title = `✓ Weekly Target Achieved ($${approvedTotal.toFixed(2)} / $${targetAmount.toFixed(2)}) — ${slotLabel}`;
      message = `CURRENT STATUS: Full Compliance Achieved. Your approved claims total $${approvedTotal.toFixed(2)} USD for week ${weekId}.\nWHAT YOU NEED TO DO: You have met your weekly obligation. Continue standard device monitoring.\nPOLICY: You are safe from weekly auto-suspension for this cycle.`;
      type = 'target_reminder';
    } else {
      title = `⚠ ACTION REQUIRED: Target Balance Remaining $${remainingTarget.toFixed(2)} — ${slotLabel}`;
      message = `CURRENT STATUS: Approved: $${approvedTotal.toFixed(2)} / Target: $${targetAmount.toFixed(2)} USD (${pendingTotal > 0 ? `$${pendingTotal.toFixed(2)} pending review` : 'No pending claims'}). Remaining Target: $${remainingTarget.toFixed(2)} USD.\n\nWHAT YOU NEED TO DO: Submit your required claims before the end of this week (${isWeeklyPlan ? 'Weekly $40 can be sent any day' : 'Daily $10 per day'}).\n\nCONSEQUENCE OF FAILURE: Failing to achieve the $40 weekly target rule results in immediate, irrevocable system auto-suspension, and you are required to leave the station before tomorrow at 8:00 AM.`;
      type = 'target_warning';
    }

    // Insert notification to database
    await sendNotificationToUser({
      userId: workerProfile.id,
      userEmail: workerProfile.email,
      title,
      message,
      type,
      metadata: { 
        weekId, 
        slot, 
        date: todayDate, 
        approvedTotal, 
        remainingTarget, 
        targetAmount,
        isWeeklyPlan 
      }
    });

    // Mark slot completed
    localStorage.setItem(storageKey, 'true');

    // Play ding chime
    playDingSound();
  } catch (e) {
    console.error('[notificationService] Error during daily reminder check:', e);
  }
}
