import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState(() => localStorage.getItem('df_theme') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('df_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  useEffect(() => {
    // Fetch current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Subscribe to real-time profile changes to instantly enforce blocks/unblocks
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`profile-watch-${user.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${user.id}`,
      }, (payload) => {
        setProfile(payload.new);
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [user]);

  const fetchProfile = async (currentUser) => {
    try {
      let { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .single();

      if (error && error.code === 'PGRST116') {
        // Fallback profile creation
        const isSeed = currentUser.email?.toLowerCase() === 'sammyseth260@gmail.com';
        const { data: newProf } = await supabase.from('profiles').insert([{
          id: currentUser.id,
          email: currentUser.email,
          role: isSeed ? 'seed_admin' : 'worker',
          is_blocked: false,
        }]).select().single();
        data = newProf;
      }

      setProfile(data);
    } catch (e) {
      console.error('Error fetching profile:', e);
    } finally {
      setLoading(false);
    }
  };

  const login = (email, password) => supabase.auth.signInWithPassword({ email, password });
  const signup = (email, password) => supabase.auth.signUp({ email, password });
  const resetPassword = (email) => {
    const siteUrl = import.meta.env.VITE_SITE_URL || (typeof window !== 'undefined' ? window.location.origin : '');
    const redirectUrl = `${siteUrl.replace(/\/$/, '')}/reset-password`;
    return supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl,
    });
  };
  const updatePassword = (newPassword) => supabase.auth.updateUser({ password: newPassword });
  const verifyOtp = (email, token, type = 'signup') => supabase.auth.verifyOtp({ email, token, type });
  const logout = () => supabase.auth.signOut();

  const value = {
    user,
    profile,
    loading,
    theme,
    toggleTheme,
    login,
    signup,
    resetPassword,
    updatePassword,
    verifyOtp,
    logout,
    refreshProfile: () => user && fetchProfile(user),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
