import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Shield, Server, Users, Smartphone, X, Key, DollarSign, FileText } from 'lucide-react';

export default function Sidebar({ isOpen, onClose }) {
  const { profile } = useAuth();
  const role = profile?.role || 'worker';

  const isSeed = role === 'seed_admin';
  const isSuper = role === 'super_admin' || isSeed;
  const isAdmin = role === 'admin' || isSuper;

  const linkStyle = ({ isActive }) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    borderRadius: '10px',
    textDecoration: 'none',
    color: isActive ? '#fff' : 'var(--text-muted)',
    background: isActive ? 'linear-gradient(135deg, var(--primary), var(--primary-hover))' : 'transparent',
    fontWeight: isActive ? 700 : 500,
    fontSize: '14px',
    transition: 'all 0.2s ease'
  });

  return (
    <>
      {/* Mobile Drawer Overlay */}
      {isOpen && (
        <div 
          onClick={onClose} 
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 45
          }} 
        />
      )}

      <aside style={{
        position: 'fixed',
        top: '64px',
        left: 0,
        bottom: 0,
        width: '260px',
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-color)',
        padding: '20px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        zIndex: 50,
        transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.3s ease'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', padding: '0 8px' }}>
          <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', fontWeight: 700 }}>
            Navigation
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        {isSeed && (
          <NavLink to="/seed-admin" onClick={onClose} style={linkStyle}>
            <Shield size={18} /> Seed Owner Hub
          </NavLink>
        )}

        {isSuper && (
          <NavLink to="/super-admin" onClick={onClose} style={linkStyle}>
            <Server size={18} /> Super Admin Devices
          </NavLink>
        )}

        {isAdmin && (
          <NavLink to="/admin" onClick={onClose} style={linkStyle}>
            <Users size={18} /> Admin Allocations
          </NavLink>
        )}

        {isAdmin && (
          <NavLink to="/admin/claims" onClick={onClose} style={linkStyle}>
            <FileText size={18} /> Claims & Audits
          </NavLink>
        )}

        <NavLink to="/worker" onClick={onClose} style={linkStyle}>
          <Smartphone size={18} /> My Assigned Devices
        </NavLink>

        <NavLink to="/worker/claims" onClick={onClose} style={linkStyle}>
          <DollarSign size={18} /> My Claims & Records
        </NavLink>

        <div style={{ marginTop: 'auto', padding: '14px', background: 'var(--bg-main)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Key size={14} color="var(--primary)" /> Role Access
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Logged in as <b>{role.replace('_', ' ').toUpperCase()}</b>
          </div>
        </div>
      </aside>
    </>
  );
}
