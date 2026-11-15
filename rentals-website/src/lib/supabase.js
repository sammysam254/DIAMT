import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://xbolsgcntkfzzpqnulsa.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhib2xzZ2NudGtmenpwcW51bHNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3OTU2NTAsImV4cCI6MjEwNTM3MTY1MH0.u18WPrgklzJM2kCk4-OxGKoecSuUx4BuOitHrXQNUIk';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
