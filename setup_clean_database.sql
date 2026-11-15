-- ══════════════════════════════════════════════════════════════════════════════
-- COMPLETE CLEAN DATABASE SCHEMA INITIALIZATION
-- Project: https://xbolsgcntkfzzpqnulsa.supabase.co
-- Run this in your Supabase Project -> SQL Editor
-- (Fresh start: Zero migrated workers/devices. Users create accounts cleanly)
-- ══════════════════════════════════════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 1. PROFILES TABLE ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'worker' CHECK (role IN ('seed_admin', 'super_admin', 'admin', 'worker')),
    super_admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    is_blocked BOOLEAN DEFAULT FALSE,
    blocked_reason TEXT DEFAULT NULL,
    blocked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    claim_criteria TEXT DEFAULT NULL,
    pending_claim_criteria TEXT DEFAULT NULL,
    criteria_change_reason TEXT DEFAULT NULL,
    criteria_requested_at TIMESTAMPTZ DEFAULT NULL,
    auto_suspended_week TEXT DEFAULT NULL,
    is_auto_suspended BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── 2. MACHINE BINDINGS TABLE ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.machine_bindings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    binding_code TEXT UNIQUE NOT NULL,
    machine_name TEXT DEFAULT 'Windows Agent Machine',
    mac_address TEXT DEFAULT NULL,
    local_ip TEXT DEFAULT NULL,
    broadcast_ip TEXT DEFAULT '255.255.255.255',
    status TEXT DEFAULT 'online',
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    super_admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    is_licensed BOOLEAN DEFAULT TRUE,
    license_mode TEXT DEFAULT 'licensed' CHECK (license_mode IN ('licensed', 'free')),
    license_note TEXT DEFAULT 'Active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── 3. DEVICES TABLE ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    serial TEXT UNIQUE NOT NULL,
    model TEXT DEFAULT 'Android Device',
    brand TEXT DEFAULT 'Generic',
    stream_url TEXT,
    local_url TEXT,
    port INT,
    binding_code TEXT REFERENCES public.machine_bindings(binding_code) ON DELETE CASCADE,
    status TEXT DEFAULT 'online',
    is_deleted_from_view BOOLEAN DEFAULT FALSE,
    is_available_for_rental BOOLEAN DEFAULT FALSE,
    is_seed_admin_only BOOLEAN DEFAULT FALSE,
    monthly_rental_price NUMERIC(10,2) DEFAULT 49.00,
    rented_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    rental_status TEXT DEFAULT 'available',
    rented_at TIMESTAMP WITH TIME ZONE,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── 4. DEVICE RENTALS TABLE ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.device_rentals (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    serial_number TEXT UNIQUE NOT NULL,
    user_id TEXT,
    device_model TEXT,
    device_brand TEXT,
    monthly_fee NUMERIC DEFAULT 30.00,
    currency TEXT DEFAULT 'USD',
    status TEXT DEFAULT 'unpaid',
    binding_code TEXT,
    stream_url TEXT,
    stealth_root_enabled BOOLEAN DEFAULT TRUE,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. DEVICE ASSIGNMENTS TABLE ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.device_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    assigned_to_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    assigned_by_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    access_password TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(device_id, assigned_to_user_id)
);

-- ── 6. WORKER CLAIMS TABLE ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.worker_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    worker_email TEXT NOT NULL,
    week_identifier TEXT NOT NULL,
    day_of_week TEXT NOT NULL,
    claim_date DATE NOT NULL,
    amount NUMERIC(10,2) NOT NULL DEFAULT 10.00,
    plan_type TEXT NOT NULL DEFAULT 'daily_10',
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

-- ── 7. SYSTEM SETTINGS TABLE ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.system_settings (
    key TEXT PRIMARY KEY,
    value JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── 8. USER PROFILES COMPATIBILITY TABLE ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id TEXT PRIMARY KEY,
    email TEXT,
    role TEXT DEFAULT 'operator',
    wallet_balance NUMERIC DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── 9. ROW LEVEL SECURITY & POLICIES ─────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_rentals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read profiles" ON public.profiles;
CREATE POLICY "Allow public read profiles" ON public.profiles FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow all update profiles" ON public.profiles;
CREATE POLICY "Allow all update profiles" ON public.profiles FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow public read machine_bindings" ON public.machine_bindings;
CREATE POLICY "Allow public read machine_bindings" ON public.machine_bindings FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow all write machine_bindings" ON public.machine_bindings;
CREATE POLICY "Allow all write machine_bindings" ON public.machine_bindings FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow public read devices" ON public.devices;
CREATE POLICY "Allow public read devices" ON public.devices FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow all write devices" ON public.devices;
CREATE POLICY "Allow all write devices" ON public.devices FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow all device_rentals" ON public.device_rentals;
CREATE POLICY "Allow all device_rentals" ON public.device_rentals FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow public read device_assignments" ON public.device_assignments;
CREATE POLICY "Allow public read device_assignments" ON public.device_assignments FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow all write device_assignments" ON public.device_assignments;
CREATE POLICY "Allow all write device_assignments" ON public.device_assignments FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow public read worker_claims" ON public.worker_claims;
CREATE POLICY "Allow public read worker_claims" ON public.worker_claims FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow all write worker_claims" ON public.worker_claims;
CREATE POLICY "Allow all write worker_claims" ON public.worker_claims FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow public read system_settings" ON public.system_settings;
CREATE POLICY "Allow public read system_settings" ON public.system_settings FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow all write system_settings" ON public.system_settings;
CREATE POLICY "Allow all write system_settings" ON public.system_settings FOR ALL USING (true);

DROP POLICY IF EXISTS "Allow all user_profiles" ON public.user_profiles;
CREATE POLICY "Allow all user_profiles" ON public.user_profiles FOR ALL USING (true);

-- ── 10. REPLICA IDENTITY FULL (REALTIME SUPPORT) ─────────────────────────────
ALTER TABLE public.profiles REPLICA IDENTITY FULL;
ALTER TABLE public.machine_bindings REPLICA IDENTITY FULL;
ALTER TABLE public.devices REPLICA IDENTITY FULL;
ALTER TABLE public.device_rentals REPLICA IDENTITY FULL;
ALTER TABLE public.device_assignments REPLICA IDENTITY FULL;
ALTER TABLE public.worker_claims REPLICA IDENTITY FULL;
ALTER TABLE public.system_settings REPLICA IDENTITY FULL;
ALTER TABLE public.user_profiles REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'devices') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'machine_bindings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.machine_bindings;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'device_assignments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.device_assignments;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'profiles') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'device_rentals') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.device_rentals;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'worker_claims') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.worker_claims;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'system_settings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.system_settings;
  END IF;
END $$;

-- ── 11. AUTOMATIC PROFILE CREATION TRIGGER ON AUTH SIGNUP ────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    CASE 
      WHEN LOWER(NEW.email) = 'sammyseth260@gmail.com' THEN 'seed_admin'
      ELSE 'worker'
    END
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 12. IMMUNITY RULE FOR ADMINS & SEED ADMIN ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.protect_admins_from_suspension()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role IN ('admin', 'super_admin', 'seed_admin') OR LOWER(NEW.email) = 'sammyseth260@gmail.com' THEN
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
FOR EACH ROW EXECUTE FUNCTION public.protect_admins_from_suspension();

-- ── 13. AUTO-CLEAR DEVICE ASSIGNMENTS WHEN WORKER IS BLOCKED ──────────────────
CREATE OR REPLACE FUNCTION public.handle_user_blocked()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_blocked = TRUE AND (OLD.is_blocked IS DISTINCT FROM TRUE) THEN
    DELETE FROM public.device_assignments
    WHERE assigned_to_user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_user_blocked ON public.profiles;
CREATE TRIGGER on_user_blocked
  AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_blocked();
