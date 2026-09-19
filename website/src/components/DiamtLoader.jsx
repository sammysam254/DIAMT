import React from 'react';

/**
 * DIAMT Signature Quantum Orbital Loader
 * High-performance, unique branded loading animation for DIAMT Cloud Platform.
 */
export default function DiamtLoader({ 
  text = 'SYNCHRONIZING HARDWARE NODES', 
  subtext = 'Connecting to Autonomous Device Grid...',
  fullScreen = false,
  size = 'default' 
}) {
  const isSmall = size === 'small';

  const content = (
    <div className={`diamt-loader-container ${isSmall ? 'small' : ''}`}>
      {/* Precision Holographic Core */}
      <div className="diamt-loader-core">
        {/* Outer Orbital Scanning Ring */}
        <div className="diamt-orbit-ring outer" />
        
        {/* Inner Counter-Rotating Ring */}
        <div className="diamt-orbit-ring inner" />
        
        {/* Precision Crosshair Target Indicators */}
        <div className="diamt-crosshair top" />
        <div className="diamt-crosshair bottom" />
        <div className="diamt-crosshair left" />
        <div className="diamt-crosshair right" />

        {/* Central Luminous DIAMT Badge */}
        <div className="diamt-core-emblem">
          <svg viewBox="0 0 24 24" fill="none" className="diamt-core-svg">
            <path 
              d="M12 2L2 7L12 12L22 7L12 2Z" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
            />
            <path 
              d="M2 17L12 22L22 17" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
            />
            <path 
              d="M2 12L12 17L22 12" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
            />
          </svg>
        </div>

        {/* Ambient Radial Energy Aura */}
        <div className="diamt-core-aura" />
      </div>

      {/* Typography & System Identification */}
      {!isSmall && (
        <div className="diamt-loader-info">
          <div className="diamt-loader-brand">
            DIAMT <span className="diamt-brand-accent">CLOUD</span>
          </div>
          
          <div className="diamt-loader-title">
            <span className="diamt-pulse-dot" />
            {text}
          </div>

          {subtext && (
            <div className="diamt-loader-subtext">
              {subtext}
            </div>
          )}

          {/* Laser Progressive Scanner Line */}
          <div className="diamt-laser-track">
            <div className="diamt-laser-beam" />
          </div>

          {/* Micro Telemetry Badges */}
          <div className="diamt-loader-telemetry">
            <span className="telemetry-pill">NODE: ACTIVE</span>
            <span className="telemetry-separator">•</span>
            <span className="telemetry-pill">ENCRYPTION: TLS 1.3</span>
            <span className="telemetry-separator">•</span>
            <span className="telemetry-pill">LATENCY: &lt;15ms</span>
          </div>
        </div>
      )}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="diamt-loader-fullscreen">
        {content}
      </div>
    );
  }

  return content;
}
