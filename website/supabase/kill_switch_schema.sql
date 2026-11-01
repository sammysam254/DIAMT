-- ─────────────────────────────────────────────────────────────────────────────
--  DIAMT — Global System Kill Switch Schema
--  Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create table (one row only — id = 1 is the singleton record)
CREATE TABLE IF NOT EXISTS public.system_kill_switch (
  id              INTEGER PRIMARY KEY DEFAULT 1,
  is_active       BOOLEAN NOT NULL DEFAULT FALSE,
  activated_by    TEXT,
  activated_at    TIMESTAMPTZ,
  deactivated_at  TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Enforce singleton: only row id=1 may ever exist
  CONSTRAINT singleton CHECK (id = 1)
);

-- 2. Seed the singleton row if not present
INSERT INTO public.system_kill_switch (id, is_active)
VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

-- 3. Row-Level Security
ALTER TABLE public.system_kill_switch ENABLE ROW LEVEL SECURITY;

-- Anyone (including anon / desktop agent) can READ the kill switch state
CREATE POLICY "kill_switch_public_read"
  ON public.system_kill_switch
  FOR SELECT
  USING (true);

-- Only authenticated users may UPDATE (seed admin enforces this on the UI side)
CREATE POLICY "kill_switch_auth_update"
  ON public.system_kill_switch
  FOR UPDATE
  USING (auth.role() = 'authenticated');

-- 4. Enable Realtime on the table so agents receive instant change notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.system_kill_switch;

