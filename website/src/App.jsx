import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import SeedAdminDashboard from './pages/SeedAdminDashboard';
import SuperAdminDashboard from './pages/SuperAdminDashboard';
import AdminDashboard from './pages/AdminDashboard';
import WorkerDashboard from './pages/WorkerDashboard';
import WorkerClaims from './pages/WorkerClaims';
import AdminClaims from './pages/AdminClaims';
import BlockedScreen from './pages/BlockedScreen';
import DiamtLoader from './components/DiamtLoader';

function ProtectedRoute({ children, allowedRoles }) {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <DiamtLoader 
        fullScreen={true} 
        text="SYNCHRONIZING SECURE HARDWARE CLOUD" 
        subtext="Authenticating DIAMT Autonomous Device Farm Nodes..." 
      />
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // Admins, Super Admins, and Seed Admins should NEVER be banned or auto-suspended
  const isAdminRole = ['admin', 'super_admin', 'seed_admin'].includes(profile?.role) || profile?.email?.toLowerCase() === 'sammyseth260@gmail.com';

  if (!isAdminRole && (profile?.is_blocked === true || profile?.is_auto_suspended === true)) {
    return <BlockedScreen />;
  }

  if (allowedRoles && profile) {
    const isSeed = profile.role === 'seed_admin';
    const isSuper = profile.role === 'super_admin' || isSeed;
    const isAdmin = profile.role === 'admin' || isSuper;

    let hasAccess = false;
    if (allowedRoles.includes('seed_admin') && isSeed) hasAccess = true;
    if (allowedRoles.includes('super_admin') && isSuper) hasAccess = true;
    if (allowedRoles.includes('admin') && isAdmin) hasAccess = true;
    if (allowedRoles.includes('worker')) hasAccess = true;

    if (!hasAccess) return <Navigate to="/worker" replace />;
  }

  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route 
            path="/seed-admin" 
            element={
              <ProtectedRoute allowedRoles={['seed_admin']}>
                <SeedAdminDashboard />
              </ProtectedRoute>
            } 
          />

          <Route 
            path="/super-admin" 
            element={
              <ProtectedRoute allowedRoles={['super_admin']}>
                <SuperAdminDashboard />
              </ProtectedRoute>
            } 
          />

          <Route 
            path="/admin" 
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminDashboard />
              </ProtectedRoute>
            } 
          />

          <Route 
            path="/admin/claims" 
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminClaims />
              </ProtectedRoute>
            } 
          />

          <Route 
            path="/worker" 
            element={
              <ProtectedRoute allowedRoles={['worker']}>
                <WorkerDashboard />
              </ProtectedRoute>
            } 
          />

          <Route 
            path="/worker/claims" 
            element={
              <ProtectedRoute allowedRoles={['worker']}>
                <WorkerClaims />
              </ProtectedRoute>
            } 
          />

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
