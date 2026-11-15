/**
 * ============================================================================
 * Scrcpy v3.3.4 Production Browser Client Snippet (WebCodecs + Native Control)
 * ============================================================================
 * Drop this minimal snippet directly into your cloud rental dashboard.
 * Features:
 *  - High-performance, hardware-accelerated H.264 decoding via WebCodecs VideoDecoder
 *  - Frame 1 instant rendering with zero smearing or green screen artifacts
 *  - Exact 32-byte binary INJECT_TOUCH_EVENT encoding directly over WebSocket
 *  - 14-byte binary INJECT_KEYCODE encoding for Back, Home, App Switch, Power
 *  - UTF-8 text injection for remote keyboard input
 */

class ScrcpyDashboardClient {
  /**
   * @param {HTMLCanvasElement} canvasElement - Target canvas to render video frames
   * @param {string} wsUrl - WebSocket URL e.g. "ws://localhost:8090/ws/device/SERIAL?token=JWT"
   */
  constructor(canvasElement, wsUrl) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d', { alpha: false, desynchronized: true });
    this.wsUrl = wsUrl;

    this.ws = null;
    this.decoder = null;
    this.videoWidth = 1080;
    this.videoHeight = 1920;
    this.isMouseDown = false;
    this.frameIndex = 0;

    this._initDecoder();
    this._attachCanvasInputListeners();
  }

  /**
   * Initialize WebCodecs VideoDecoder
   */
  _initDecoder() {
    if (!('VideoDecoder' in window)) {
      console.error('WebCodecs VideoDecoder API is not supported in this browser.');
      return;
    }

    this.decoder = new VideoDecoder({
      output: (frame) => {
        // Automatically sync canvas internal resolution with negotiated video stream
        if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
          this.canvas.width = frame.displayWidth;
          this.canvas.height = frame.displayHeight;
          this.videoWidth = frame.displayWidth;
          this.videoHeight = frame.displayHeight;
        }

        // Draw decoded hardware video frame to canvas
        this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);

        // Crucial: close VideoFrame immediately to prevent GPU memory exhaustion
        frame.close();
      },
      error: (err) => {
        console.error('WebCodecs VideoDecoder error:', err);
      },
    });

    // Configure for H.264 Baseline/Main profile with zero latency
    this.decoder.configure({
      codec: 'avc1.42002A', // H.264 Baseline Profile Level 4.2
      optimizeForLatency: true,
      hardwareAcceleration: 'prefer-hardware',
    });
  }

  /**
   * Connect to the Host Bridge WebSocket relay
   */
  connect() {
    console.log(`[ScrcpyClient] Connecting to ${this.wsUrl}...`);
    this.ws = new WebSocket(this.wsUrl);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      console.log('[ScrcpyClient] WebSocket connection established.');
    };

    this.ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        // Metadata JSON packet from server
        try {
          const meta = JSON.parse(event.data);
          if (meta.type === 'metadata') {
            this.videoWidth = meta.width || 1080;
            this.videoHeight = meta.height || 1920;
            this.canvas.width = this.videoWidth;
            this.canvas.height = this.videoHeight;
            console.log(`[ScrcpyClient] Device metadata: ${meta.model} (${this.videoWidth}x${this.videoHeight})`);
          }
        } catch (_) {}
        return;
      }

      // Binary payload: Audio (0x41 tag) or Video (H.264 NAL units)
      if (event.data instanceof ArrayBuffer) {
        const u8 = new Uint8Array(event.data);
        if (u8.length >= 3 && u8[0] === 0x41) {
          this._handleAudioPacket(u8);
          return;
        }
        this._handleVideoPacket(u8);
      }
    };

    this.ws.onclose = (e) => {
      console.warn(`[ScrcpyClient] Stream disconnected (code: ${e.code}, reason: ${e.reason})`);
    };

    this.ws.onerror = (err) => {
      console.error('[ScrcpyClient] WebSocket error:', err);
    };
  }

  /**
   * Inspect H.264 payload for IDR / SPS NAL units and decode frame
   */
  _handleVideoPacket(data) {
    if (!this.decoder || this.decoder.state === 'closed') return;

    // Detect if chunk contains an IDR Keyframe (NAL type 5) or SPS (NAL type 7)
    let isKeyframe = false;
    for (let i = 0; i < Math.min(data.length - 4, 128); i++) {
      if (data[i] === 0 && data[i + 1] === 0) {
        let nalByte = -1;
        if (data[i + 2] === 1) {
          nalByte = data[i + 3];
        } else if (data[i + 2] === 0 && data[i + 3] === 1) {
          nalByte = data[i + 4];
        }
        if (nalByte !== -1) {
          const nalType = nalByte & 0x1f;
          if (nalType === 5 || nalType === 7) {
            isKeyframe = true;
            break;
          }
        }
      }
    }

    try {
      this.decoder.decode(
        new EncodedVideoChunk({
          type: isKeyframe ? 'key' : 'delta',
          timestamp: (this.frameIndex++) * (1000000 / 60), // Microsecond timestamp
          data: data,
        })
      );
    } catch (err) {
      console.warn('[ScrcpyClient] Decode error:', err.message);
    }
  }

  /**
   * Handle incoming audio packets (tagged with 0x41)
   */
  _handleAudioPacket(u8) {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass({ sampleRate: 48000 });
      }
    }
    if (!this.audioCtx) return;
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }

    const codec = u8[1]; // 0x4F = Opus, 0x43 = AAC, 0x52 = Raw PCM
    const isConfig = u8[2] === 0x01;
    const payload = u8.subarray(3);

    // Initialize WebCodecs AudioDecoder for Opus
    if (codec === 0x4F && !this.audioDecoder && typeof AudioDecoder !== 'undefined') {
      try {
        this.audioDecoder = new AudioDecoder({
          output: (audioData) => {
            if (!this.audioCtx) return;
            const buffer = this.audioCtx.createBuffer(
              audioData.numberOfChannels,
              audioData.numberOfFrames,
              audioData.sampleRate
            );
            for (let i = 0; i < audioData.numberOfChannels; i++) {
              audioData.copyTo(buffer.getChannelData(i), { planeIndex: i });
            }
            const source = this.audioCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(this.audioCtx.destination);
            const now = this.audioCtx.currentTime;
            this.audioPlayTime = Math.max(now, this.audioPlayTime || now);
            source.start(this.audioPlayTime);
            this.audioPlayTime += buffer.duration;
            audioData.close();
          },
          error: (err) => console.warn('[Audio] AudioDecoder error:', err)
        });
        this.audioDecoder.configure({
          codec: 'opus',
          numberOfChannels: 2,
          sampleRate: 48000
        });
      } catch (_) {}
    }

    if (this.audioDecoder && this.audioDecoder.state === 'configured' && !isConfig) {
      try {
        this.audioDecoder.decode(new EncodedAudioChunk({
          type: 'key',
          timestamp: performance.now() * 1000,
          data: payload
        }));
      } catch (_) {}
    }
  }

  // ==========================================================================
  // Binary Control Packet Transmission (Scrcpy v3.3.4 Native Format)
  // ==========================================================================

  /**
   * Encodes and sends the exact 32-byte scrcpy v3.3.4 INJECT_TOUCH_EVENT:
   *   [0]     type = 2
   *   [1]     action: 0=DOWN, 1=UP, 2=MOVE
   *   [2..9]  pointer_id: i64BE (-2n generic finger)
   *   [10..13] x: i32BE
   *   [14..17] y: i32BE
   *   [18..19] width: u16BE
   *   [20..21] height: u16BE
   *   [22..23] pressure: u16BE (0..0xFFFF)
   *   [24..27] action_button: i32BE (1=PRIMARY on DOWN, 0 otherwise)
   *   [28..31] buttons: i32BE (1 on DOWN/MOVE, 0 on UP)
   */
  sendTouchEvent(action, clientX, clientY, pressure = 1.0) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Scale canvas client coordinates to internal device resolution
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.videoWidth / rect.width;
    const scaleY = this.videoHeight / rect.height;

    const x = Math.max(0, Math.min(this.videoWidth - 1, Math.round((clientX - rect.left) * scaleX)));
    const y = Math.max(0, Math.min(this.videoHeight - 1, Math.round((clientY - rect.top) * scaleY)));
    const normPressure = action === 1 ? 0 : Math.min(0xffff, Math.max(1, Math.floor(pressure * 65535)));

    const buffer = new ArrayBuffer(32);
    const view = new DataView(buffer);

    view.setUint8(0, 2);                      // INJECT_TOUCH_EVENT = 2
    view.setUint8(1, action);                 // 0=DOWN, 1=UP, 2=MOVE
    view.setBigInt64(2, -2n, false);          // Generic finger pointer ID (-2n)
    view.setInt32(10, x, false);              // X coordinate
    view.setInt32(14, y, false);              // Y coordinate
    view.setUint16(18, this.videoWidth, false); // Device resolution width
    view.setUint16(20, this.videoHeight, false);// Device resolution height
    view.setUint16(22, normPressure, false);  // Normalized pressure
    view.setInt32(24, 0, false);              // action_button = 0 (native touchscreen finger)
    view.setInt32(28, 0, false);              // buttons = 0 (direct touch, zero mouse emulation delay)

    this.ws.send(buffer);
  }

  /**
   * Encodes and sends the exact 14-byte scrcpy v3.3.4 INJECT_KEYCODE:
   *   [0]     type = 0
   *   [1]     action: 0=DOWN, 1=UP
   *   [2..5]  keycode: i32BE
   *   [6..9]  repeat: i32BE
   *   [10..13] metastate: i32BE
   */
  sendKeycode(keycode, action = 0) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const buffer = new ArrayBuffer(14);
    const view = new DataView(buffer);

    view.setUint8(0, 0);          // INJECT_KEYCODE = 0
    view.setUint8(1, action);     // 0=DOWN, 1=UP
    view.setInt32(2, keycode, false);
    view.setInt32(6, 0, false);   // repeat = 0
    view.setInt32(10, 0, false);  // metastate = 0

    this.ws.send(buffer);
  }

  /**
   * Navigation Helper Methods (Injects DOWN + UP sequence)
   */
  sendBack() {
    this.sendKeycode(4, 0); // Android AKEYCODE_BACK DOWN
    setTimeout(() => this.sendKeycode(4, 1), 50); // UP
  }

  sendHome() {
    this.sendKeycode(3, 0); // Android AKEYCODE_HOME DOWN
    setTimeout(() => this.sendKeycode(3, 1), 50); // UP
  }

  sendAppSwitch() {
    this.sendKeycode(187, 0); // Android AKEYCODE_APP_SWITCH DOWN
    setTimeout(() => this.sendKeycode(187, 1), 50); // UP
  }

  sendPower() {
    this.sendKeycode(26, 0); // Android AKEYCODE_POWER DOWN
    setTimeout(() => this.sendKeycode(26, 1), 50); // UP
  }

  sendVolumeUp() {
    this.sendKeycode(24, 0); // Android AKEYCODE_VOLUME_UP
    setTimeout(() => this.sendKeycode(24, 1), 50);
  }

  sendVolumeDown() {
    this.sendKeycode(25, 0); // Android AKEYCODE_VOLUME_DOWN
    setTimeout(() => this.sendKeycode(25, 1), 50);
  }

  /**
   * Injects UTF-8 text into focused remote input field
   */
  sendText(text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !text) return;

    const textEncoder = new TextEncoder();
    const encoded = textEncoder.encode(text);
    const buffer = new ArrayBuffer(5 + encoded.length);
    const view = new DataView(buffer);

    view.setUint8(0, 1);                  // INJECT_TEXT = 1
    view.setInt32(1, encoded.length, false);
    new Uint8Array(buffer, 5).set(encoded);

    this.ws.send(buffer);
  }

  /**
   * Attach touch and pointer listeners directly to the target canvas
   * Uses requestAnimationFrame coalescing on move events to match native 60/120Hz display refresh
   * and prevent network packet queue lag. DOWN and UP events fire immediately.
   */
  _attachCanvasInputListeners() {
    let pendingMove = null;
    let moveRaf = null;

    const flushPendingMove = () => {
      if (pendingMove) {
        this.sendTouchEvent(2, pendingMove.clientX, pendingMove.clientY, pendingMove.pressure);
        pendingMove = null;
      }
      moveRaf = null;
    };

    const queueMove = (clientX, clientY, pressure = 1.0) => {
      pendingMove = { clientX, clientY, pressure };
      if (!moveRaf) {
        moveRaf = requestAnimationFrame(flushPendingMove);
      }
    };

    // Mouse Events
    this.canvas.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.isMouseDown = true;
      if (moveRaf) { cancelAnimationFrame(moveRaf); moveRaf = null; pendingMove = null; }
      this.sendTouchEvent(0, e.clientX, e.clientY); // 0 = DOWN (immediate)
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isMouseDown) return;
      e.preventDefault();
      queueMove(e.clientX, e.clientY); // 2 = MOVE (rAF synchronized)
    });

    window.addEventListener('mouseup', (e) => {
      if (!this.isMouseDown) return;
      e.preventDefault();
      this.isMouseDown = false;
      if (moveRaf) { cancelAnimationFrame(moveRaf); moveRaf = null; }
      if (pendingMove) {
        this.sendTouchEvent(2, pendingMove.clientX, pendingMove.clientY, pendingMove.pressure);
        pendingMove = null;
      }
      this.sendTouchEvent(1, e.clientX, e.clientY); // 1 = UP (immediate)
    });

    // Touch Events for Mobile / Tablet rental clients
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (moveRaf) { cancelAnimationFrame(moveRaf); moveRaf = null; pendingMove = null; }
      if (e.touches.length > 0) {
        const touch = e.touches[0];
        this.sendTouchEvent(0, touch.clientX, touch.clientY, touch.force || 1.0);
      }
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length > 0) {
        const touch = e.touches[0];
        queueMove(touch.clientX, touch.clientY, touch.force || 1.0);
      }
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (moveRaf) { cancelAnimationFrame(moveRaf); moveRaf = null; }
      if (e.changedTouches.length > 0) {
        const touch = e.changedTouches[0];
        this.sendTouchEvent(1, touch.clientX, touch.clientY, 0);
      }
    }, { passive: false });
  }

  /**
   * Close connection and release hardware decoder
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.decoder) {
      try { this.decoder.close(); } catch (_) {}
      this.decoder = null;
    }
  }
}

// Example usage in your existing cloud dashboard HTML:
// const client = new ScrcpyDashboardClient(
//   document.getElementById('phone-canvas'),
//   'ws://localhost:8090/ws/device/YOUR_SERIAL_HERE'
// );
// client.connect();

