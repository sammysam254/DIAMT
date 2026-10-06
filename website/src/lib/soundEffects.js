// Browser Web Audio API Sound FX Synthesizer (No external audio file dependencies)

export const playWelcomeSound = () => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    // Futuristic 4-note ascending chord (E5 -> G#5 -> B5 -> E6)
    const notes = [659.25, 830.61, 987.77, 1318.51];
    notes.forEach((freq, index) => {
      const startTime = ctx.currentTime + index * 0.08;
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      // Envelope
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.25, startTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.55);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.6);
    });
  } catch (e) {
    console.warn('Audio playback not supported or user gesture required:', e);
  }
};

export const playSuccessSound = () => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    // High 2-note chime (C6 -> G6)
    [1046.5, 1567.98].forEach((freq, index) => {
      const startTime = ctx.currentTime + index * 0.1;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.2, startTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.45);
    });
  } catch (e) {
    console.warn('Audio playback error:', e);
  }
};

/**
 * Authentic Facebook-style in-app notification chime ("Ding / Pop" bell)
 */
export const playDingSound = () => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const now = ctx.currentTime;

    // Two crisp harmonic chime tones (G#5 -> C#6 pop with sparkle)
    const tones = [
      { freq: 830.61, start: 0, dur: 0.18, vol: 0.22, type: 'sine' },
      { freq: 1108.73, start: 0.04, dur: 0.28, vol: 0.28, type: 'sine' },
      { freq: 2217.46, start: 0.04, dur: 0.15, vol: 0.08, type: 'triangle' } // Crystal sparkle overtone
    ];

    tones.forEach(({ freq, start, dur, vol, type }) => {
      const startTime = now + start;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, startTime);

      // Fast percussive attack, smooth exponential bell decay
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(vol, startTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + dur + 0.05);
    });
  } catch (e) {
    console.warn('Notification audio playback error:', e);
  }
};

