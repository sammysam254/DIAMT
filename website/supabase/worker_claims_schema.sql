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

-- 6. SYSTEM AUTOMATED AUDIT FOR WEEKLY PLAN TARGET DEFAULTS
CREATE OR REPLACE FUNCTION public.auto_audit_weekly_plan_defaults(audit_week TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  WITH defaulting_workers AS (
    SELECT p.id
    FROM public.profiles p
    WHERE p.role = 'worker'
      AND p.claim_criteria = 'weekly_40'
      AND COALESCE(p.is_auto_suspended, FALSE) = FALSE
      AND NOT EXISTS (
        SELECT 1
        FROM public.worker_claims wc
        WHERE wc.worker_id = p.id
          AND wc.week_identifier = audit_week
          AND (wc.plan_type = 'weekly_40' OR wc.amount >= 40.00)
      )
  )
  UPDATE public.profiles p
  SET is_auto_suspended = TRUE,
      is_blocked = TRUE,
      auto_suspended_week = audit_week,
      blocked_reason = 'Due to failing to achieve weekly target rule as per your subscribed plan (Weekly $40 claim not submitted for week ' || audit_week || '), the system has auto-suspended you and you are required to leave the station before tomorrow at 8 AM, as your services are no longer needed.',
      updated_at = NOW()
  FROM defaulting_workers dw
  WHERE p.id = dw.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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


