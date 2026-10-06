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
