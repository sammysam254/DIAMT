-- ══════════════════════════════════════════════════════════════════════════════
-- DIAMT PLATFORM — WORKER CLAIMS, VERIFIED BADGES & SUSPENSION SCHEMA
-- Execute in your Supabase Project -> SQL Editor
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. ADD CRITERIA & AUDIT FIELDS TO PROFILES IF NOT PRESENT
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS claim_criteria TEXT DEFAULT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pending_claim_criteria TEXT DEFAULT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS criteria_change_reason TEXT DEFAULT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS criteria_requested_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS auto_suspended_week TEXT DEFAULT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_auto_suspended BOOLEAN DEFAULT FALSE;

-- 2. CREATE WORKER CLAIMS TABLE
CREATE TABLE IF NOT EXISTS public.worker_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    worker_email TEXT NOT NULL,
    week_identifier TEXT NOT NULL, -- e.g. '2026-W41'
    day_of_week TEXT NOT NULL,     -- 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', or 'Weekly'
    claim_date DATE NOT NULL,
    amount NUMERIC(10,2) NOT NULL DEFAULT 10.00,
    plan_type TEXT NOT NULL DEFAULT 'daily_10', -- 'daily_10' or 'weekly_40'
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    claimed_at TIMESTAMPTZ DEFAULT NOW(),
    approved_at TIMESTAMPTZ DEFAULT NULL,
    approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    approver_email TEXT DEFAULT NULL,
    is_forced_by_seed BOOLEAN DEFAULT FALSE,
    rejection_reason TEXT DEFAULT NULL,
    notes TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_worker_day_week UNIQUE (worker_id, week_identifier, day_of_week)
);

-- 3. ENABLE ROW LEVEL SECURITY & POLICIES
ALTER TABLE public.worker_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read worker_claims" ON public.worker_claims;
CREATE POLICY "Allow public read worker_claims" ON public.worker_claims FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow authenticated write worker_claims" ON public.worker_claims;
CREATE POLICY "Allow authenticated write worker_claims" ON public.worker_claims FOR ALL USING (true);

-- 4. REALTIME REPLICATION
ALTER TABLE public.worker_claims REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'worker_claims') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.worker_claims;
  END IF;
END $$;

-- 5. SEED ADMIN EXCLUSIVE UNSUSPEND STORED PROCEDURE
CREATE OR REPLACE FUNCTION public.seed_unsuspend_worker(target_worker_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.profiles
  SET is_auto_suspended = FALSE,
      is_blocked = FALSE,
      auto_suspended_week = NULL,
      blocked_reason = NULL,
      updated_at = NOW()
  WHERE id = target_worker_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. SYSTEM AUTOMATED AUDIT FOR WEEKLY PLAN TARGET DEFAULTS (ALL WORKER PLANS)
CREATE OR REPLACE FUNCTION public.auto_audit_weekly_plan_defaults(audit_week TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  WITH defaulting_workers AS (
    SELECT p.id,
           COALESCE((
             SELECT SUM(wc.amount)
             FROM public.worker_claims wc
             WHERE wc.worker_id = p.id
               AND wc.week_identifier = audit_week
               AND wc.status <> 'rejected'
           ), 0) AS total_valid_claims
    FROM public.profiles p
    WHERE p.role = 'worker'
      AND p.role NOT IN ('admin', 'super_admin', 'seed_admin')
      AND p.email NOT IN ('sammyseth260@gmail.com')
      AND COALESCE(p.is_auto_suspended, FALSE) = FALSE
      AND COALESCE(p.is_blocked, FALSE) = FALSE
      AND COALESCE((
        SELECT SUM(wc.amount)
        FROM public.worker_claims wc
        WHERE wc.worker_id = p.id
          AND wc.week_identifier = audit_week
          AND wc.status <> 'rejected'
      ), 0) < 40.00
  )
  UPDATE public.profiles p
  SET is_auto_suspended = TRUE,
      is_blocked = TRUE,
      auto_suspended_week = audit_week,
      blocked_reason = 'Due to failing to achieve weekly target rule as per your subscribed plan (Submitted $' || TRIM(TO_CHAR(dw.total_valid_claims, '999990.00')) || ' of $40.00 required for week ' || audit_week || '), the system has auto-suspended you and you are required to leave the station before tomorrow at 8 AM, as your services are no longer needed.',
      updated_at = NOW()
  FROM defaulting_workers dw
  WHERE p.id = dw.id
    AND p.role = 'worker'
    AND p.role NOT IN ('admin', 'super_admin', 'seed_admin');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- IMMUNITY RULE: Admins, Super Admins, and Seed Admins can NEVER be blocked or auto-suspended
CREATE OR REPLACE FUNCTION public.protect_admins_from_suspension()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role IN ('admin', 'super_admin', 'seed_admin') OR NEW.email = 'sammyseth260@gmail.com' THEN
    NEW.is_blocked := FALSE;
    NEW.is_auto_suspended := FALSE;
    NEW.blocked_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_admins ON public.profiles;
CREATE TRIGGER trg_protect_admins
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_admins_from_suspension();

-- 7. USER IN-APP NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS public.user_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'info', -- 'claim_approved', 'claim_rejected', 'claim_issued', 'target_reminder', 'target_warning', 'admin_message'
    metadata JSONB DEFAULT '{}'::jsonb,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read user_notifications" ON public.user_notifications;
CREATE POLICY "Allow public read user_notifications" ON public.user_notifications FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow authenticated write user_notifications" ON public.user_notifications;
CREATE POLICY "Allow authenticated write user_notifications" ON public.user_notifications FOR ALL USING (true);

ALTER TABLE public.user_notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
  END IF;
END $$;

-- 8. ADMIN ONE-CLICK UNBLOCK FOR AUDIT-SUSPENDED WORKERS
CREATE OR REPLACE FUNCTION public.admin_unblock_audit_suspended_workers()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  UPDATE public.profiles
  SET is_auto_suspended = FALSE,
      is_blocked = FALSE,
      auto_suspended_week = NULL,
      blocked_reason = NULL,
      updated_at = NOW()
  WHERE role = 'worker'
    AND is_auto_suspended = TRUE
    AND (blocked_reason ILIKE '%audit%' OR blocked_reason ILIKE '%Weekly%');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. FULLY AUTOMATED SUNDAY 23:59 AUDIT FUNCTION (RUNS SERVER-SIDE)
CREATE OR REPLACE FUNCTION public.auto_audit_completed_week()
RETURNS INTEGER AS $$
DECLARE
  v_target_week TEXT;
BEGIN
  -- Computes the week cycle that concludes Sunday at 23:59 (Africa/Nairobi UTC+3)
  -- Subtracting 1 hour ensures that running at 23:59 Sunday or 00:05 Monday targets the correct completed week
  v_target_week := TO_CHAR((NOW() AT TIME ZONE 'Africa/Nairobi' - INTERVAL '1 hour'), 'IYYY') || '-W' || TO_CHAR((NOW() AT TIME ZONE 'Africa/Nairobi' - INTERVAL '1 hour'), 'IW');
  
  RETURN public.auto_audit_weekly_plan_defaults(v_target_week);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. CRON SCHEDULER (EXECUTE IN SUPABASE SQL EDITOR TO RUN EVERY SUNDAY AT 23:59 LOCAL / 20:59 UTC)
-- Note: Requires pg_cron extension enabled in your Supabase project (Database -> Extensions -> pg_cron)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove existing job if already registered to avoid duplicates
SELECT cron.unschedule('auto-audit-sunday-2359') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-audit-sunday-2359');

-- Schedule to run automatically every Sunday at 23:59 Nairobi (20:59 UTC)
SELECT cron.schedule(
  'auto-audit-sunday-2359',
  '59 20 * * 0',
  $$ SELECT public.auto_audit_completed_week(); $$
);



