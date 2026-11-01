import React, { useEffect, useState } from 'react';

// ─── GlobalLockOverlay ────────────────────────────────────────────────────────
// Full-screen red alarm overlay rendered over the entire app when the seed
// admin activates the global kill switch.  Cannot be dismissed by end users.
// Disappears instantly the moment the seed admin toggles the switch OFF.

export default function GlobalLockOverlay() {
  const [pulse, setPulse] = useState(true);

  // Alternate glow intensity for the pulsing animation
  useEffect(() => {
    const interval = setInterval(() => setPulse(p => !p), 900);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: '#0a0000',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* Animated background glow blobs */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '-20%',
            left: '10%',
            width: '800px',
            height: '800px',
            borderRadius: '50%',
            background: pulse
              ? 'rgba(220, 38, 38, 0.35)'
              : 'rgba(220, 38, 38, 0.12)',
            filter: 'blur(140px)',
            transition: 'background 0.9s ease',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-20%',
            right: '5%',
            width: '700px',
            height: '700px',
            borderRadius: '50%',
            background: pulse
              ? 'rgba(185, 28, 28, 0.28)'
              : 'rgba(185, 28, 28, 0.08)',
            filter: 'blur(160px)',
            transition: 'background 0.9s ease',
          }}
        />
      </div>

      {/* Content card */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          textAlign: 'center',
          maxWidth: '560px',
          width: '90%',
          padding: '56px 40px',
          background: 'rgba(10, 0, 0, 0.85)',
          border: pulse
            ? '2px solid rgba(239, 68, 68, 0.9)'
            : '2px solid rgba(239, 68, 68, 0.35)',
          borderRadius: '24px',
          boxShadow: pulse
            ? '0 0 80px rgba(220, 38, 38, 0.5), 0 0 160px rgba(220, 38, 38, 0.2)'
            : '0 0 30px rgba(220, 38, 38, 0.15)',
          transition: 'border-color 0.9s ease, box-shadow 0.9s ease',
        }}
      >
        {/* Danger icon */}
        <div
          style={{
            width: '96px',
            height: '96px',
            borderRadius: '50%',
            background: pulse
              ? 'rgba(220, 38, 38, 0.25)'
              : 'rgba(220, 38, 38, 0.08)',
            border: pulse
              ? '3px solid rgba(239, 68, 68, 0.9)'
              : '3px solid rgba(239, 68, 68, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 28px',
            transition: 'all 0.9s ease',
          }}
        >
          {/* Warning triangle */}
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke={pulse ? '#ef4444' : '#b91c1c'}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transition: 'stroke 0.9s ease' }}
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>

        {/* Alert badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(220, 38, 38, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '20px',
            padding: '4px 14px',
            marginBottom: '20px',
            color: '#f87171',
            fontSize: '11px',
            fontWeight: 800,
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
          }}
        >
          ⚠ SYSTEM ALERT
        </div>

        {/* Main heading — bouncing / pulsing text */}
        <h1
          style={{
            fontSize: '30px',
            fontWeight: 900,
            color: pulse ? '#ef4444' : '#b91c1c',
            lineHeight: 1.15,
            marginBottom: '20px',
            letterSpacing: '-0.5px',
            transition: 'color 0.9s ease',
            textShadow: pulse
              ? '0 0 30px rgba(239, 68, 68, 0.7), 0 0 60px rgba(239, 68, 68, 0.3)'
              : '0 0 10px rgba(185, 28, 28, 0.2)',
          }}
        >
          LICENCE PERMANENTLY REVOKED
        </h1>

        <p
          style={{
            color: '#f87171',
            fontSize: '15px',
            lineHeight: '1.7',
            marginBottom: '32px',
            fontWeight: 500,
          }}
        >
          All system access has been suspended by the platform owner.
          <br />
          All device streams and user accounts are locked pending resolution.
        </p>

        <div
          style={{
            background: 'rgba(220, 38, 38, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            borderRadius: '14px',
            padding: '18px 22px',
            textAlign: 'left',
            fontSize: '13px',
            color: '#fca5a5',
            lineHeight: '1.6',
          }}
        >
          <strong style={{ color: '#ef4444', display: 'block', marginBottom: '6px' }}>
            Why is this happening?
          </strong>
          Your subscription or licence agreement with the platform owner has been
          terminated. Access will be restored only when the platform owner lifts
          this restriction.
        </div>
      </div>

      {/* Keyframe animations */}
      <style>{`
        @keyframes ks-bounce {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  );
}

