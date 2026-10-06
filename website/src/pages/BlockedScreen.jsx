import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { 
  ShieldOff, LogOut, Mail, Download, FileText, 
  AlertTriangle, Clock, Award, ShieldAlert 
} from 'lucide-react';
import { 
  generateTerminationLetterPdf, 
  generateWeeklyWorkerClaimsPdf 
} from '../lib/pdfGenerator';
import { getISOWeekString } from '../lib/weekUtils';

export default function BlockedScreen() {
  const { profile, logout } = useAuth();
  const [claims, setClaims] = useState([]);
  const [loadingClaims, setLoadingClaims] = useState(false);

  const isAutoSuspended = profile?.is_auto_suspended === true;
  const suspensionWeek = profile?.auto_suspended_week || getISOWeekString();

  useEffect(() => {
    if (isAutoSuspended && profile?.id) {
      setLoadingClaims(true);
      supabase
        .from('worker_claims')
        .select('*')
        .eq('worker_id', profile.id)
        .eq('week_identifier', suspensionWeek)
        .then(({ data }) => {
          setClaims(data || []);
          setLoadingClaims(false);
        })
        .catch(() => setLoadingClaims(false));
    }
  }, [isAutoSuspended, profile?.id, suspensionWeek]);

  const handleDownloadTerminationLetter = () => {
    generateTerminationLetterPdf({
      worker: profile,
      weekIdentifier: suspensionWeek,
      reason: profile?.blocked_reason,
      claims: claims
    });
  };

  const handleDownloadWeeklyRecord = () => {
    generateWeeklyWorkerClaimsPdf({
      worker: profile,
      weekIdentifier: suspensionWeek,
      claims: claims
    });
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary, #090d16)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      position: 'relative',
      fontFamily: "'Inter', system-ui, sans-serif"
    }}>
      {/* Background Ambience Blobs */}
      <div style={{
        position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
        zIndex: 0, pointerEvents: 'none', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: '-10%', left: '15%',
          width: '500px', height: '500px', borderRadius: '50%',
          background: isAutoSuspended ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.12)', 
          filter: 'blur(100px)',
        }} />
        <div style={{
          position: 'absolute', bottom: '10%', right: '10%',
          width: '600px', height: '600px', borderRadius: '50%',
          background: isAutoSuspended ? 'rgba(5,150,105,0.08)' : 'rgba(148,0,0,0.1)', 
          filter: 'blur(120px)',
        }} />
      </div>

      <div style={{
        position: 'relative', zIndex: 1,
        maxWidth: isAutoSuspended ? '620px' : '480px', 
        width: '100%',
        background: 'var(--bg-card, #111827)',
        border: isAutoSuspended ? '1px solid rgba(239,68,68,0.35)' : '1px solid rgba(239,68,68,0.3)',
        borderRadius: '24px',
        padding: isAutoSuspended ? '40px 36px' : '48px 40px',
        textAlign: 'center',
        boxShadow: '0 0 60px rgba(0,0,0,0.4)',
        animation: 'fadeIn 0.5s ease-out',
      }}>

        {/* Header Icon */}
        <div style={{
          width: '76px', height: '76px',
          borderRadius: '22px',
          background: isAutoSuspended ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.15)',
          border: '2px solid rgba(239,68,68,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          {isAutoSuspended ? (
            <ShieldAlert size={38} color="#ef4444" />
          ) : (
            <ShieldOff size={36} color="#ef4444" />
          )}
        </div>

        {isAutoSuspended ? (
          <>
            {/* Auto-Suspension Notice (Target Rule Default) */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              padding: '4px 12px',
              borderRadius: '20px',
              color: '#ef4444',
              fontSize: '11px',
              fontWeight: 800,
              letterSpacing: '0.5px',
              marginBottom: '12px'
            }}>
              SYSTEM COMPLIANCE AUDIT ENFORCED
            </div>

            <h1 style={{
              fontSize: '24px', fontWeight: 800,
              color: '#ef4444', marginBottom: '12px',
              lineHeight: 1.2
            }}>
              Automatic Account Termination Notice
            </h1>

            {/* Mandatory Exit Text Required by User */}
            <div style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: '14px',
              padding: '18px 20px',
              marginBottom: '20px',
              textAlign: 'left',
              lineHeight: '1.6'
            }}>
              <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--text-main, #f1f5f9)', fontWeight: 500 }}>
                Due to failing to achieve the weekly target rule as per your subscribed plan, the system has automatically suspended your account and your services are terminated.
              </p>
              <div style={{
                marginTop: '12px',
                paddingTop: '12px',
                borderTop: '1px solid rgba(239, 68, 68, 0.2)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: '#f87171',
                fontSize: '13px',
                fontWeight: 700
              }}>
                <Clock size={16} />
                <span>You are required to leave the station before tomorrow at 8:00 AM, as your services are no longer needed.</span>
              </div>
            </div>

            {/* User credentials & Audit cycle */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '10px',
              marginBottom: '24px',
              textAlign: 'left'
            }}>
              <div style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border-color, #1e293b)',
                borderRadius: '10px',
                padding: '10px 14px'
              }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)', fontWeight: 600 }}>Worker Identity</div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-main, #f1f5f9)', fontWeight: 600, marginTop: '2px' }}>
                  {profile?.email}
                </div>
              </div>

              <div style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border-color, #1e293b)',
                borderRadius: '10px',
                padding: '10px 14px'
              }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)', fontWeight: 600 }}>Suspension Cycle</div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-main, #f1f5f9)', fontWeight: 600, marginTop: '2px' }}>
                  Week {suspensionWeek}
                </div>
              </div>
            </div>

            {/* Official PDF Action Buttons (Green Theme) */}
            <div style={{
              background: 'rgba(5, 150, 105, 0.06)',
              border: '1px solid rgba(5, 150, 105, 0.25)',
              borderRadius: '16px',
              padding: '18px',
              marginBottom: '24px',
              textAlign: 'left'
            }}>
              <div style={{ fontSize: '12px', fontWeight: 800, color: '#10b981', textTransform: 'uppercase', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Award size={14} /> Official Audit Documents (Green Theme)
              </div>
              <p style={{ margin: '0 0 14px', fontSize: '12px', color: 'var(--text-muted, #94a3b8)' }}>
                Download your official employment termination letter and verified weekly claims statement for your personal records:
              </p>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  onClick={handleDownloadTerminationLetter}
                  style={{
                    flex: '1 1 220px',
                    padding: '11px 16px',
                    background: 'linear-gradient(135deg, #064e3b, #059669)',
                    border: 'none',
                    borderRadius: '10px',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '12.5px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    boxShadow: '0 4px 12px rgba(5, 150, 105, 0.25)'
                  }}
                >
                  <Download size={15} /> Download Termination Letter (PDF)
                </button>

                <button
                  onClick={handleDownloadWeeklyRecord}
                  disabled={loadingClaims}
                  style={{
                    flex: '1 1 220px',
                    padding: '11px 16px',
                    background: 'rgba(5, 150, 105, 0.15)',
                    border: '1px solid rgba(5, 150, 105, 0.35)',
                    borderRadius: '10px',
                    color: '#10b981',
                    fontWeight: 700,
                    fontSize: '12.5px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                >
                  <FileText size={15} /> Download Week Claims Record (PDF)
                </button>
              </div>
            </div>

            <p style={{ fontSize: '11.5px', color: 'var(--text-dim, #64748b)', marginBottom: '20px' }}>
              * System clearance notice: Only the Seed Administrator holds authorization to review or reinstate accounts.
            </p>
          </>
        ) : (
          <>
            {/* Standard Manual Block Screen */}
            <h1 style={{
              fontSize: '26px', fontWeight: 800,
              color: '#ef4444', marginBottom: '8px',
            }}>
              Access Revoked
            </h1>

            <p style={{
              color: 'var(--text-muted, #94a3b8)', fontSize: '14px',
              lineHeight: '1.7', marginBottom: '24px',
            }}>
              Your account has been suspended by an administrator. You no longer have access to the DIAMT system.
            </p>

            {profile?.blocked_reason && (
              <div style={{
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)',
                borderRadius: '12px',
                padding: '14px 18px',
                marginBottom: '24px',
                textAlign: 'left',
              }}>
                <div style={{ fontSize: '11px', fontWeight: 800, color: '#ef4444', textTransform: 'uppercase', marginBottom: '4px' }}>
                  Reason
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-main, #f1f5f9)' }}>
                  {profile.blocked_reason}
                </div>
              </div>
            )}

            <div style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--border-color, #1e293b)',
              borderRadius: '12px',
              padding: '12px 18px',
              marginBottom: '28px',
              display: 'flex', alignItems: 'center', gap: '10px',
            }}>
              <Mail size={16} color="var(--text-muted, #94a3b8)" />
              <span style={{ fontSize: '13px', fontFamily: 'monospace', color: 'var(--text-muted, #94a3b8)' }}>
                {profile?.email}
              </span>
            </div>

            <p style={{ fontSize: '12px', color: 'var(--text-dim, #64748b)', marginBottom: '20px' }}>
              If you believe this is a mistake, contact your administrator.
            </p>
          </>
        )}

        {/* Sign Out Button */}
        <button
          onClick={logout}
          style={{
            width: '100%', padding: '12px',
            background: 'rgba(239,68,68,0.15)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: '10px',
            color: '#ef4444', fontWeight: 700,
            fontSize: '14px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          }}
        >
          <LogOut size={16} /> Sign Out
        </button>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
