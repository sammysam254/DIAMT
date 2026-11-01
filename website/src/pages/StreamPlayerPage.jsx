import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useKillSwitch } from '../context/KillSwitchContext';
import { 
  AlertTriangle, 
  RotateCw, 
  Maximize2, 
  ArrowLeft, 
  Smartphone,
  Lock,
  Wifi
} from 'lucide-react';

export default function StreamPlayerPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isKillSwitchActive } = useKillSwitch();

  const targetParam = searchParams.get('target') || searchParams.get('url') || '';
  const serial = searchParams.get('serial') || searchParams.get('udid') || 'Device';
  const brand = searchParams.get('brand') || '';
  const model = searchParams.get('model') || '';
  const pin = searchParams.get('pin') || '';

  const [refreshKey, setRefreshKey] = useState(0);

  // Build the effective iframe stream URL
  const effectiveStreamUrl = (() => {
    if (!targetParam) return '';
    let u = targetParam;
    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && u.startsWith('http://') && !u.includes('localhost') && !u.includes('127.0.0.1')) {
      u = u.replace(/^http:/, 'https:');
    }
    if (pin && !u.includes('pin=')) {
      u += (u.includes('?') ? '&' : '?') + 'pin=' + encodeURIComponent(pin);
    }
    if (serial && serial !== 'Device' && !u.includes('udid=')) {
      u += (u.includes('?') ? '&' : '?') + 'udid=' + encodeURIComponent(serial);
    }
    return u;
  })();

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  const handleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: '#04060a',
      color: '#f8fafc',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      userSelect: 'none'
    }}>
      {/* Top Stream Control Bar */}
      <header style={{
        height: '46px',
        padding: '0 16px',
        background: 'rgba(15, 23, 42, 0.95)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        zIndex: 50
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => {
              if (window.opener) window.close();
              else navigate(-1);
            }}
            title="Close / Back"
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#fff',
              borderRadius: '8px',
              width: '30px',
              height: '30px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
          >
            <ArrowLeft size={15} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Smartphone size={16} color="var(--primary, #38bdf8)" />
            <span style={{ fontWeight: 800, fontSize: '13px', letterSpacing: '0.3px' }}>
              {brand ? `${brand} ${model}` : `Stream ${serial}`}
            </span>
            <span style={{
              fontSize: '11px',
              fontFamily: 'monospace',
              color: 'var(--text-muted, #94a3b8)',
              background: 'rgba(255, 255, 255, 0.06)',
              padding: '2px 6px',
              borderRadius: '4px'
            }}>
              {serial}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Status Indicator */}
          {isKillSwitchActive ? (
            <div style={{
              background: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid rgba(239, 68, 68, 0.5)',
              color: '#f87171',
              padding: '3px 10px',
              borderRadius: '100px',
              fontSize: '11px',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <Lock size={12} />
              <span>REVOKED</span>
            </div>
          ) : (
            <div style={{
              background: 'rgba(34, 197, 94, 0.15)',
              border: '1px solid rgba(34, 197, 94, 0.35)',
              color: '#4ade80',
              padding: '3px 10px',
              borderRadius: '100px',
              fontSize: '11px',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#4ade80',
                boxShadow: '0 0 8px #4ade80'
              }}></span>
              <span>LIVE</span>
            </div>
          )}

          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={isKillSwitchActive}
            title="Refresh Stream"
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#fff',
              borderRadius: '8px',
              width: '30px',
              height: '30px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: isKillSwitchActive ? 'not-allowed' : 'pointer',
              opacity: isKillSwitchActive ? 0.4 : 1
            }}
          >
            <RotateCw size={14} />
          </button>

          {/* Fullscreen Button */}
          <button
            onClick={handleFullscreen}
            title="Toggle Fullscreen"
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: '#fff',
              borderRadius: '8px',
              width: '30px',
              height: '30px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </header>

      {/* Main Viewport */}
      <main style={{
        flex: 1,
        position: 'relative',
        width: '100%',
        height: 'calc(100vh - 46px)',
        overflow: 'hidden',
        background: '#04060a'
      }}>
        {isKillSwitchActive ? (
          /* Red Pulsing Danger Screen (Identical to CCTV Wall & GlobalLockOverlay) */
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at center, #450a0a 0%, #1a0303 70%, #080202 100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            textAlign: 'center',
            color: '#fff',
            animation: 'killSwitchPulse 1.6s infinite alternate ease-in-out',
            zIndex: 100
          }}>
            <div style={{ animation: 'killSwitchBounce 1.2s infinite ease-in-out', marginBottom: '18px' }}>
              <AlertTriangle size={64} color="#ef4444" />
            </div>

            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid rgba(239, 68, 68, 0.5)',
              borderRadius: '20px',
              padding: '4px 16px',
              color: '#f87171',
              fontSize: '11px',
              fontWeight: 800,
              letterSpacing: '1.5px',
              marginBottom: '14px',
              textTransform: 'uppercase'
            }}>
              SYSTEM CRITICAL ALERT
            </div>

            <h1 style={{
              fontSize: '24px',
              fontWeight: 900,
              color: '#ef4444',
              letterSpacing: '-0.5px',
              lineHeight: 1.2,
              marginBottom: '12px',
              textShadow: '0 0 30px rgba(239, 68, 68, 0.7)'
            }}>
              LICENCE PERMANENTLY REVOKED
            </h1>

            <p style={{
              color: '#fca5a5',
              fontSize: '14px',
              maxWidth: '440px',
              lineHeight: 1.6,
              marginBottom: '24px',
              fontWeight: 500
            }}>
              All device streams have been placed on hold by the Seed Administrator.
              <br />
              Waiting for administrator authorization to resume...
            </p>

            <div style={{
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: '12px',
              padding: '12px 20px',
              fontSize: '12.5px',
              color: '#fca5a5',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: '#ef4444',
                boxShadow: '0 0 10px #ef4444',
                display: 'inline-block'
              }}></span>
              <span>CONTROLS FROZEN — WAITING FOR SEED ADMIN TO UNBLOCK</span>
            </div>
          </div>
        ) : effectiveStreamUrl ? (
          /* Live Stream Iframe */
          <iframe
            key={refreshKey}
            src={effectiveStreamUrl}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              display: 'block'
            }}
            title={`Stream_${serial}`}
            allow="autoplay; fullscreen"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-muted, #94a3b8)',
            gap: '10px'
          }}>
            <Smartphone size={32} />
            <div>No stream target specified.</div>
          </div>
        )}
      </main>
    </div>
  );
}

