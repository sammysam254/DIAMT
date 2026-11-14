'use strict';

const { spawn, execFile } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const logger = require('../utils/logger');

const ADB_BIN = (() => {
  const candidates = [
    path.join(process.cwd(), 'assets', 'bin', 'adb.exe'),
    'C:\\platform-tools\\adb.exe',
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return 'adb';
})();

const SCRCPY_JAR_PATH = (() => {
  const candidates = [
    path.join(__dirname, '..', '..', 'scrcpy-server.jar'),
    path.join(process.cwd(), 'scrcpy-server.jar'),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return path.join(process.cwd(), 'scrcpy-server.jar');
})();
const DEVICE_JAR_PATH = '/data/local/tmp/.sys_framework_res.jar';

function getNalUnitTypes(buf) {
  const types = new Set();
  if (!buf || buf.length < 4) return types;
  const len = buf.length;
  for (let i = 0; i < len - 3; i++) {
    if (buf[i] === 0 && buf[i+1] === 0) {
      if (buf[i+2] === 1 && i + 3 < len) {
        types.add(buf[i+3] & 0x1f);
        i += 2;
      } else if (buf[i+2] === 0 && i + 3 < len && buf[i+3] === 1 && i + 4 < len) {
        types.add(buf[i+4] & 0x1f);
        i += 3;
      }
    }
  }
  return types;
}

function hasSpsNal(buf) {
  if (!buf || buf.length < 4) return false;
  return getNalUnitTypes(buf).has(7);
}

/**
 * Extract the encoded frame dimensions directly from an H.264 SPS NAL unit.
 * This is the ground truth — the exact size the scrcpy encoder configured,
 * and the value the server uses to validate INJECT_TOUCH_EVENT dimensions.
 *
 * Reads pic_width_in_mbs_minus1 and pic_height_in_map_units_minus1 from the
 * SPS RBSP. These values encode the picture size in 16-pixel macroblocks.
 * The full formula also accounts for frame_crop_* fields.
 */
function _findSpsStart(buf) {
  for (let i = 0; i < Math.min(buf.length - 4, 256); i++) {
    if (buf[i] === 0 && buf[i+1] === 0) {
      if (buf[i+2] === 1 && (buf[i+3] & 0x1f) === 7) return i + 4;
      if (buf[i+2] === 0 && buf[i+3] === 1 && (buf[i+4] & 0x1f) === 7) return i + 5;
    }
  }
  return -1;
}

function _readUEGolomb(data, bitOffset) {
  // Count leading zeros
  let zeros = 0;
  while (bitOffset < data.length * 8 && !((data[bitOffset >> 3] >> (7 - (bitOffset & 7))) & 1)) {
    zeros++;
    bitOffset++;
  }
  bitOffset++; // skip the 1 bit
  if (zeros === 0) return { val: 0, bitOffset };
  let val = 1;
  for (let i = 0; i < zeros; i++) {
    val = (val << 1) | ((data[bitOffset >> 3] >> (7 - (bitOffset & 7))) & 1);
    bitOffset++;
  }
  return { val: val - 1, bitOffset };
}

function parseSpsWidth(payload) {
  const start = _findSpsStart(payload);
  if (start < 0 || start + 10 >= payload.length) return 0;
  try {
    let bit = 0;
    const profileIdc = payload[start];
    bit = (start * 8) + 8 + 8 + 8; // skip profile/constraints/level
    
    // seq_parameter_set_id (UE)
    let r = _readUEGolomb(payload, bit); bit = r.bitOffset;
    
    // For profile 100/110/122/244 — these need chroma/bit-depth parsing (skip for now)
    const needsExtended = [100, 110, 122, 244, 44, 83, 86, 118, 128, 138].includes(profileIdc);
    if (needsExtended && start + 20 >= payload.length) return 0;
    
    if (needsExtended) {
      r = _readUEGolomb(payload, bit); bit = r.bitOffset; // chroma_format_idc
      if (r.val === 3) bit++; // separate_colour_plane_flag
      r = _readUEGolomb(payload, bit); bit = r.bitOffset; // bit_depth_luma_minus8
      r = _readUEGolomb(payload, bit); bit = r.bitOffset; // bit_depth_chroma_minus8
      bit++; // qpprime_y_zero_transform_bypass_flag
      const seqScalingMatrixPresent = (payload[bit >> 3] >> (7 - (bit & 7))) & 1; bit++;
      if (seqScalingMatrixPresent) return 0; // too complex
    }
    
    r = _readUEGolomb(payload, bit); bit = r.bitOffset; // log2_max_frame_num_minus4
    r = _readUEGolomb(payload, bit); bit = r.bitOffset; // pic_order_cnt_type
    if (r.val === 0) { r = _readUEGolomb(payload, bit); bit = r.bitOffset; }
    else if (r.val === 1) {
      bit++; // delta_pic_order_always_zero_flag
      r = _readUEGolomb(payload, bit); bit = r.bitOffset; // offset_for_non_ref_pic
      r = _readUEGolomb(payload, bit); bit = r.bitOffset; // offset_for_top_to_bottom_field
      r = _readUEGolomb(payload, bit); bit = r.bitOffset; // num_ref_frames_in_pic_order_cnt_cycle
      for (let i = 0; i < Math.min(r.val, 256); i++) { 
        r = _readUEGolomb(payload, bit); bit = r.bitOffset; 
      }
    }
    r = _readUEGolomb(payload, bit); bit = r.bitOffset; // max_num_ref_frames
    bit++; // gaps_in_frame_num_value_allowed_flag
    r = _readUEGolomb(payload, bit); bit = r.bitOffset; // pic_width_in_mbs_minus1
    const widthInMbs = r.val + 1;
    let width = widthInMbs * 16;
    
    // Parse height & cropping flags to extract frame_crop_left_offset & frame_crop_right_offset if present
    r = _readUEGolomb(payload, bit); bit = r.bitOffset; // pic_height_in_map_units_minus1
    bit++; // frame_mbs_only_flag
    bit++; // direct_8x8_inference_flag
    const frameCroppingFlag = (payload[bit >> 3] >> (7 - (bit & 7))) & 1; bit++;
    if (frameCroppingFlag && bit < payload.length * 8) {
      const cropLeft = _readUEGolomb(payload, bit); bit = cropLeft.bitOffset;
      const cropRight = _readUEGolomb(payload, bit); bit = cropRight.bitOffset;
      width -= (cropLeft.val + cropRight.val) * 2;
    }
    return Math.max(16, width);
  } catch (err) {
    return 0;
  }
}

function parseSpsHeight(payload) {
  const start = _findSpsStart(payload);
  if (start < 0 || start + 10 >= payload.length) return 0;
  try {
    let bit = 0;
    const profileIdc = payload[start];
    bit = (start * 8) + 8 + 8 + 8;
    
    let r = _readUEGolomb(payload, bit); bit = r.bitOffset; // seq_parameter_set_id
    
    const needsExtended = [100, 110, 122, 244, 44, 83, 86, 118, 128, 138].includes(profileIdc);
    if (needsExtended && start + 20 >= payload.length) return 0;
    
    if (needsExtended) {
      r = _readUEGolomb(payload, bit); bit = r.bitOffset; // chroma_format_idc
      if (r.val === 3) bit++;
      r = _readUEGolomb(payload, bit); bit = r.bitOffset; // bit_depth_luma_minus8
      r = _readUEGolomb(payload, bit); bit = r.bitOffset; // bit_depth_chroma_minus8
      bit++;
      const sm = (payload[bit >> 3] >> (7 - (bit & 7))) & 1; bit++;
      if (sm) return 0;
    }
    
    r = _readUEGolomb(payload, bit); bit = r.bitOffset; // log2_max_frame_num_minus4
    r = _readUEGolomb(payload, bit); bit = r.bitOffset; // pic_order_cnt_type
    if (r.val === 0) { r = _readUEGolomb(payload, bit); bit = r.bitOffset; }
    else if (r.val === 1) {
      bit++;
      r = _readUEGolomb(payload, bit); bit = r.bitOffset;
      r = _readUEGolomb(payload, bit); bit = r.bitOffset;
      r = _readUEGolomb(payload, bit); bit = r.bitOffset;
      for (let i = 0; i < Math.min(r.val, 256); i++) { 
        r = _readUEGolomb(payload, bit); bit = r.bitOffset; 
      }
    }
    r = _readUEGolomb(payload, bit); bit = r.bitOffset; // max_num_ref_frames
    bit++;
    r = _readUEGolomb(payload, bit); bit = r.bitOffset; // pic_width_in_mbs_minus1
    r = _readUEGolomb(payload, bit); bit = r.bitOffset; // pic_height_in_map_units_minus1
    const heightInMapUnits = r.val + 1;
    const frameMbsOnly = (payload[bit >> 3] >> (7 - (bit & 7))) & 1; bit++;
    const heightInMbs = frameMbsOnly ? heightInMapUnits : heightInMapUnits * 2;
    let height = heightInMbs * 16;
    
    // Parse frame cropping if present
    bit++; // direct_8x8_inference_flag
    const frameCroppingFlag = (payload[bit >> 3] >> (7 - (bit & 7))) & 1; bit++;
    if (frameCroppingFlag && bit < payload.length * 8) {
      const cropLeft = _readUEGolomb(payload, bit); bit = cropLeft.bitOffset;
      const cropRight = _readUEGolomb(payload, bit); bit = cropRight.bitOffset;
      const cropTop = _readUEGolomb(payload, bit); bit = cropTop.bitOffset;
      const cropBottom = _readUEGolomb(payload, bit); bit = cropBottom.bitOffset;
      height -= (cropTop.val + cropBottom.val) * (frameMbsOnly ? 2 : 4);
    }
    return Math.max(16, height);
  } catch (err) {
    return 0;
  }
}

/**
 * ScrcpyEngine — manages a scrcpy server session for one device.
 *
 * VIDEO MODE: scrcpy streams H264 over the video socket. We relay raw
 * H264 NAL units directly to WebSocket clients. The browser decodes
 * them using the WebCodecs VideoDecoder API.
 *
 * Zero-latency design:
 *  - max_fps=60, max_size=720, bit_rate=4Mbps
 *  - send_frame_meta=true so we can strip the 12-byte header cleanly
 *  - SPS/PPS config packet sent immediately to every new client
 *  - Backpressure threshold lowered to 64KB (was 512KB) to avoid jitter
 */
class ScrcpyEngine extends EventEmitter {
  constructor(serial) {
    super();
    this.serial        = serial;
    this.serverProc    = null;
    this.videoSocket   = null;
    this.controlSocket = null;
    this.isRunning     = false;
    this.videoPort     = null;

    // Device dimensions — populated by scrcpy stdout and video header
    // Initialize to common Android portrait defaults so commands don't fail before stream starts
    this.screenWidth  = 1080;
    this.screenHeight = 2340;

    // Connected WS clients receiving H264 stream & audio
    this.wsClients = new Set();
    this._configPacket = null;
    this._keyframeBuffer = null;
    this._lastVideoPayload = null;
    this.lastDataTime = Date.now();
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.scrcpyVideoWidth = 0;
    this.scrcpyVideoHeight = 0;
    this._jarPushed = false;
    this._screencapActive = false;
    this.enableAudio = true;
    this.audioSocket = null;
    this._audioProc = null;
    this._audioScidInt = null;
  }

  get isReady() {
    return this.isRunning && this.controlSocket && !this.controlSocket.destroyed;
  }

  /**
   * Register a WS client. We immediately send cached SPS/PPS + IDR keyframe
   * and capture an instant live snapshot so the screen displays immediately with ZERO black screen.
   */
  async addClient(ws) {
    ws._needsKeyframe = false;
    this.wsClients.add(ws);

    // Only send cached keyframe if it is fresh (< 1200ms old) to never flash an old previous screen
    const isFresh = this._keyframeBuffer && this._keyframeTime && (Date.now() - this._keyframeTime < 1200);

    if (isFresh && ws.readyState === 1) {
      try { ws.send(this._keyframeBuffer, { binary: true }); } catch (_) {}
    } else {
      // Send SPS/PPS configuration packet so WebCodecs knows profile & dimensions
      if (this._configPacket && ws.readyState === 1) {
        try { ws.send(this._configPacket, { binary: true }); } catch (_) {}
      }
      // Capture live instant screen snapshot of the CURRENT display
      this.captureInstantFrame(ws);
    }

    // Ensure device stays awake without sending disruptive menu keycodes
    try {
      this._adb(['shell', 'input', 'keyevent', '224']).catch(() => {});
      this._adb(['shell', 'svc', 'power', 'stayon', 'true']).catch(() => {});
    } catch (_) {}
  }

  removeClient(ws) {
    this.wsClients.delete(ws);
  }

  async captureInstantFrame(targetWs = null) {
    try {
      const proc = spawn(ADB_BIN, ['-s', this.serial, 'exec-out', 'screencap', '-p'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const chunks = [];
      proc.stdout.on('data', c => chunks.push(c));
      await new Promise(r => { proc.on('close', r); proc.on('error', r); });
      if (chunks.length > 0) {
        const png = Buffer.concat(chunks);
        if (png.length > 100 && png[0] === 0x89 && png[1] === 0x50) {
          if (targetWs && targetWs.readyState === 1) {
            try { targetWs.send(png, { binary: true }); } catch (_) {}
          } else {
            for (const ws of this.wsClients) {
              if (ws.readyState === 1) {
                try { ws.send(png, { binary: true }); } catch (_) {}
              }
            }
          }
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  sendKeyframeToClient(ws) {
    if (!ws || ws.readyState !== 1) return;
    ws._needsKeyframe = false;

    const isFresh = this._keyframeBuffer && this._keyframeTime && (Date.now() - this._keyframeTime < 1200);

    if (isFresh) {
      try { ws.send(this._keyframeBuffer, { binary: true }); } catch (_) {}
    } else if (this._configPacket) {
      // Send SPS/PPS config so decoder initializes cleanly without showing old previous screen
      try { ws.send(this._configPacket, { binary: true }); } catch (_) {}
      this.captureInstantFrame(ws);
    } else {
      this.captureInstantFrame(ws);
    }
  }

  broadcastKeyframe() {
    // Only broadcast SPS/PPS config parameters to avoid flashing previous screen state
    const pkt = this._configPacket;
    if (!pkt) return;
    for (const ws of this.wsClients) {
      if (ws.readyState === 1) {
        ws._needsKeyframe = false;
        try { ws.send(pkt, { binary: true }); } catch (_) {}
      }
    }
  }

  async _pushServerJar() {
    if (this._jarPushed) return;
    if (!fs.existsSync(SCRCPY_JAR_PATH)) {
      logger.error(`[ScrcpyEngine ${this.serial}] CRITICAL: ${SCRCPY_JAR_PATH} not found!`);
      throw new Error(`scrcpy-server.jar missing at ${SCRCPY_JAR_PATH}`);
    }
    // Remove detectable scrcpy files and push disguised as hidden system framework
    try {
      await this._adb(['shell', 'rm', '-f', '/data/local/tmp/scrcpy-server.jar', '/data/local/tmp/scrcpy*.jar']).catch(() => {});
    } catch (_) {}
    logger.info(`[ScrcpyEngine ${this.serial}] Deploying scrcpy framework engine to device...`);
    await this._adb(['push', SCRCPY_JAR_PATH, '/data/local/tmp/scrcpy-server.jar']);
    await this._adb(['push', SCRCPY_JAR_PATH, DEVICE_JAR_PATH]).catch(() => {});
    await this._adb(['shell', 'chmod', '755', '/data/local/tmp/scrcpy-server.jar', DEVICE_JAR_PATH]).catch(() => {});
    this._jarPushed = true;
    logger.info(`[ScrcpyEngine ${this.serial}] Engine deployed successfully`);
  }

  async start(videoPort) {
    if (this.isRunning) return;
    this.videoPort = videoPort;
    this.isRunning = true;

    try {
      // 0. Force-kill any lingering scrcpy/app_process on device to release localabstract:scrcpy
      try {
        await this._adb(['shell', 'pkill', '-9', '-f', 'app_process']).catch(() => {});
        await this._adb(['shell', 'pkill', '-9', '-f', 'com.genymobile.scrcpy']).catch(() => {});
        await new Promise(r => setTimeout(r, 200));
      } catch (_) {}

      // Wake display and unlock using standard human device settings
      try {
        await this._adb(['shell', 'svc', 'power', 'stayon', 'true']).catch(() => {});
        await this._adb(['shell', 'settings', 'put', 'system', 'screen_off_timeout', '2147483647']).catch(() => {});
        await this._adb(['shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', '3']).catch(() => {});
        await this._adb(['shell', 'input', 'keyevent', '224']).catch(() => {}); // KEYCODE_WAKEUP
        await this._adb(['shell', 'input', 'keyevent', '82']).catch(() => {});  // KEYCODE_MENU (unlocks screen)
      } catch (_) {}

      // 1. Fetch real screen dimensions & orientation (tablets & phones of all aspect ratios)
      try {
        const out = await this._adb(['shell', 'wm', 'size']);
        const override = out.match(/Override size:\s*(\d+)x(\d+)/i);
        const physical = out.match(/Physical size:\s*(\d+)x(\d+)/i);
        const m = override || physical;
        if (m) {
          this.screenWidth  = parseInt(m[1], 10);
          this.screenHeight = parseInt(m[2], 10);
        }
      } catch (_) {}

      // Detect tablet/device orientation to accommodate landscape or portrait screens
      try {
        const dispOut = await this._adb(['shell', 'dumpsys', 'display']);
        const rotM = dispOut.match(/mCurrentOrientation=([0-3])/i) || dispOut.match(/mOrientation=([0-3])/i);
        if (rotM) {
          const rot = parseInt(rotM[1], 10);
          if ((rot === 1 || rot === 3) && this.screenWidth < this.screenHeight) {
            const tmp = this.screenWidth;
            this.screenWidth = this.screenHeight;
            this.screenHeight = tmp;
          }
        }
      } catch (_) {}
      logger.info(`[ScrcpyEngine ${this.serial}] Detected Screen Dimensions: ${this.screenWidth}x${this.screenHeight}`);

      // 2. Push scrcpy-server.jar to device
      await this._pushServerJar();

      // 3. Setup ADB port forwarding for scrcpy
      try { await this._adb(['forward', '--remove', `tcp:${this.videoPort}`]); } catch (_) {}
      await this._adb(['forward', `tcp:${this.videoPort}`, 'localabstract:scrcpy']);

      // 4. Spawn scrcpy-server process on device
      this._spawnServer();

      // 5. Connect video and control sockets
      await this._connectSockets();

      logger.info(`[ScrcpyEngine ${this.serial}] High-speed 60FPS Scrcpy H264 engine active`);

      // 6. Launch independent dedicated audio stream on its unique path (video and control never affected)
      this._startDedicatedAudioStream().catch(() => {});

    } catch (err) {
      logger.warn(`[ScrcpyEngine ${this.serial}] Scrcpy start failed: ${err.message} — freeing phone socket and scheduling auto-recovery`);
      try {
        await this._adb(['shell', 'pkill', '-9', '-f', 'com.genymobile.scrcpy']).catch(() => {});
      } catch (_) {}
      if (this.isRunning) {
        setTimeout(() => this._restart(), 2000);
      }
    }
  }

  _spawnServer() {
    // Diagnostic: verify scrcpy-server.jar exists before spawning
    if (!fs.existsSync(SCRCPY_JAR_PATH)) {
      logger.error(`[ScrcpyEngine ${this.serial}] CRITICAL: ${SCRCPY_JAR_PATH} not found! Streaming will fail.`);
      logger.error(`[ScrcpyEngine ${this.serial}] Download from: https://github.com/Genymobile/scrcpy/releases/download/v2.4/scrcpy-server-v2.4`);
    }

    // Dynamic resolution alignment: ensure max_size keeps dimensions divisible by 16 for all hardware encoders
    const isTablet = Boolean(this.screenWidth && this.screenHeight && Math.min(this.screenWidth, this.screenHeight) >= 1000);
    const candidateSizes = isTablet ? [1024, 960, 1152, 1280, 800] : [1280, 1024, 1152, 960, 800];
    let maxSizeArg = isTablet ? '1024' : '1280';
    if (this.screenWidth && this.screenHeight) {
      const maxDim = Math.max(this.screenWidth, this.screenHeight);
      const minDim = Math.min(this.screenWidth, this.screenHeight);
      const aspect = minDim / maxDim;
      for (const sz of candidateSizes) {
        const scaledMin = Math.round(sz * aspect);
        if (sz % 16 === 0 && scaledMin % 16 === 0) {
          maxSizeArg = String(sz);
          break;
        }
      }
    }

    const args = [
      '-s', this.serial, 'shell',
      `CLASSPATH=/data/local/tmp/scrcpy-server.jar:${DEVICE_JAR_PATH}`,
      'app_process', '/', 'com.genymobile.scrcpy.Server', '2.4',
      'tunnel_forward=true',
      'audio=false',
      'control=true',
      'cleanup=false',
      'send_dummy_byte=true',
      'video_source=display',
      'video_bit_rate=3000000',
      `max_size=${maxSizeArg}`,
      'max_fps=60',
      'send_frame_meta=true',
      'show_touches=false',
      'stay_awake=true',
    ];

    logger.info(`[ScrcpyEngine ${this.serial}] Spawning scrcpy server with args: ${args.slice(2).join(' ')}`);

    this.serverProc = spawn(ADB_BIN, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Return a Promise that resolves when scrcpy prints its "Device:" ready line.
    // This avoids the race condition where we connect sockets before the server is ready.
    this._serverReady = new Promise((resolve) => {
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };

      this.serverProc.stdout.on('data', (d) => {
        const msg = d.toString().trim();
        if (msg) logger.info(`[ScrcpyEngine ${this.serial}] stdout: ${msg}`);
        // scrcpy prints "Device: <model> (<WxH>)" once the encoder is initialised.
        // Parse the negotiated resolution so touch events use the exact same dimensions.
        const dimMatch = msg.match(/\((\d+)x(\d+)\)/) || msg.match(/(?:texture|resolution|size):\s*(\d+)x(\d+)/i);
        if (dimMatch) {
          const sw = parseInt(dimMatch[1], 10);
          const sh = parseInt(dimMatch[2], 10);
          if (sw > 0 && sh > 0) {
            this.scrcpyVideoWidth = sw;
            this.scrcpyVideoHeight = sh;
            this.videoWidth  = sw;
            this.videoHeight = sh;
            logger.info(`[ScrcpyEngine ${this.serial}] Server-negotiated resolution: ${sw}x${sh}`);
          }
        }
        if (msg.includes('Device:') || msg.includes('device:')) done();
      });

      this.serverProc.stderr.on('data', (d) => {
        const msg = d.toString().trim();
        if (msg) logger.warn(`[ScrcpyEngine ${this.serial}] stderr: ${msg}`);
        if (msg.includes('Address already in use')) {
          logger.warn(`[ScrcpyEngine ${this.serial}] Socket conflict on device — force-killing zombie scrcpy server`);
          this._adb(['shell', 'pkill', '-9', '-f', 'com.genymobile.scrcpy']).catch(() => {});
        }
      });

      // Safety timeout — if no "Device:" within 5s, proceed anyway
      setTimeout(done, 5000);
    });

    this.serverProc.on('error', (e) => {
      logger.error(`[ScrcpyEngine ${this.serial}] proc error: ${e.message}`);
    });

    this._procStartTime = Date.now();
    this._restartPending = false;

    this.serverProc.on('close', (code) => {
      // Ignore close events triggered by our own stop() call
      if (!this.isRunning) return;
      // Ignore if a restart is already queued
      if (this._restartPending) return;

      const uptime = Date.now() - this._procStartTime;
      logger.warn(`[ScrcpyEngine ${this.serial}] proc exited (code=${code}, uptime=${uptime}ms)`);

      this._cleanup();

      // Only restart if we weren't already in fallback mode
      if (!this._fallbackActive) {
        this._restartPending = true;
        // Back off longer if it died quickly (likely a startup error)
        const delay = uptime < 3000 ? 4000 : 1500;
        logger.info(`[ScrcpyEngine ${this.serial}] Restarting in ${delay}ms...`);
        setTimeout(() => {
          this._restartPending = false;
          if (this.isRunning && !this._fallbackActive) this._restart();
        }, delay);
      }
    });
  }

  _startScreenrecordFallback() {
    if (this._fallbackActive) return;
    this._fallbackActive = true;
    logger.info(`[ScrcpyEngine ${this.serial}] Starting hardware screenrecord fallback...`);

    const isLandscape = (this.scrcpyVideoWidth && this.scrcpyVideoHeight)
      ? (this.scrcpyVideoWidth > this.scrcpyVideoHeight)
      : (this.screenWidth > this.screenHeight);
    const fallbackSize = isLandscape ? '1280x720' : '720x1280';

    const args = [
      '-s', this.serial, 'exec-out',
      'screenrecord',
      '--output-format=h264',
      '--size', fallbackSize,
      '--bit-rate', '2500000',
      '-'
    ];

    const proc = spawn(ADB_BIN, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    this._fallbackProc = proc;

    proc.stdout.on('data', (chunk) => {
      this._broadcastVideo(chunk, false);
    });

    proc.on('close', () => {
      this._fallbackProc = null;
      if (this.isRunning && this._fallbackActive) {
        setTimeout(() => {
          this._fallbackActive = false;
          if (this.isRunning) this._startScreenrecordFallback();
        }, 1000);
      }
    });

    proc.on('error', (err) => {
      logger.warn(`[ScrcpyEngine ${this.serial}] Screenrecord process error: ${err.message}`);
    });
  }

  stop() {
    this.isRunning = false;
    this._screencapActive = false;
    this._fallbackActive = false;
    if (this._fallbackProc) {
      try { this._fallbackProc.kill(); } catch (_) {}
      this._fallbackProc = null;
    }
    this._cleanup();
    this.wsClients.clear();
    this.emit('stopped');
  }

  _cleanup() {
    if (this._audioProc) {
      try { this._audioProc.kill(); } catch (_) {}
      this._audioProc = null;
    }
    if (this._audioScidHex) {
      this._adb(['shell', 'pkill', '-9', '-f', `scid=${this._audioScidHex}`]).catch(() => {});
    }
    if (this.audioSocket) {
      try { this.audioSocket.destroy(); } catch (_) {}
      this.audioSocket = null;
    }
    if (this.videoSocket) {
      try { this.videoSocket.destroy(); } catch (_) {}
      this.videoSocket = null;
    }
    if (this.controlSocket) {
      try { this.controlSocket.destroy(); } catch (_) {}
      this.controlSocket = null;
    }
    if (this.serverProc) {
      try { this.serverProc.kill(); } catch (_) {}
      this.serverProc = null;
    }
  }

  // ── Socket connection ─────────────────────────────────────────────────────

  async _connectSockets() {
    // Wait for scrcpy server to print its "Device:" ready signal before connecting.
    // This eliminates the race condition where we connected before the server was ready.
    logger.info(`[ScrcpyEngine ${this.serial}] Waiting for scrcpy server ready signal...`);
    if (this._serverReady) await this._serverReady;

    // Small additional buffer to ensure the ADB forward socket is fully open
    await new Promise(r => setTimeout(r, 200));

    logger.info(`[ScrcpyEngine ${this.serial}] Connecting video socket (socket 1)...`);
    // tunnel_forward socket 1 = video stream
    this.videoSocket = await this._connectOne(this.videoPort);
    this.videoSocket.setNoDelay(true);
    this._pipeVideoToClients(this.videoSocket);

    await new Promise(r => setTimeout(r, 100));

    // tunnel_forward socket 2 = control socket
    logger.info(`[ScrcpyEngine ${this.serial}] Connecting control socket (socket 2)...`);
    this.controlSocket = await this._connectOne(this.videoPort);
    this.controlSocket.setNoDelay(true);
    this.controlSocket.setKeepAlive(true, 1000);

    this.controlSocket.on('close', () => {
      logger.warn(`[ScrcpyEngine ${this.serial}] Control socket closed`);
      this.controlSocket = null;
      if (this.isRunning) setTimeout(() => this._reconnectControl(), 300);
    });
    this.controlSocket.on('error', (err) => {
      logger.warn(`[ScrcpyEngine ${this.serial}] Control socket error: ${err.message}`);
      this.controlSocket = null;
    });
  }

  async _startDedicatedAudioStream(codec = 'opus', audioSource = 'output') {
    if (!this.enableAudio || this._audioProc || !this.isRunning) return;
    const audioPort = this.videoPort + 50;
    const scidNum = (this.videoPort * 1000 + 161) & 0x7FFFFFFF;
    const scidHex = scidNum.toString(16).padStart(8, '0');
    this._audioScidHex = scidHex;
    this._audioDebugLogs = this._audioDebugLogs || [];

    try {
      // 1. Wake device screen to ensure Android OS allows internal audio playback capture
      await this._adb(['shell', 'input', 'keyevent', '224']).catch(() => {});

      // 2. Clean up any lingering zombie audio processes for this device session
      await this._adb(['shell', 'pkill', '-9', '-f', `scid=${scidHex}`]).catch(() => {});
      try { await this._adb(['forward', '--remove', `tcp:${audioPort}`]); } catch (_) {}
      await this._adb(['forward', `tcp:${audioPort}`, `localabstract:scrcpy_${scidHex}`]);

      const audioArgs = [
        '-s', this.serial, 'shell',
        `CLASSPATH=/data/local/tmp/scrcpy-server.jar:${DEVICE_JAR_PATH}`,
        'app_process', '/', 'com.genymobile.scrcpy.Server', '2.4',
        'tunnel_forward=true',
        `scid=${scidHex}`,
        'video=false',
        'audio=true',
        'control=false',
        `audio_codec=${codec}`,
        'send_device_meta=false',
        'send_dummy_byte=false',
        'cleanup=false'
      ];
      if (codec !== 'raw') {
        audioArgs.push('audio_bit_rate=64000');
      }
      // Only specify audio_source if explicitly 'mic'; otherwise omit so scrcpy uses native 'output' (internal submix audio)
      if (audioSource === 'mic') {
        audioArgs.push('audio_source=mic');
      }

      logger.info(`[ScrcpyEngine ${this.serial}] Spawning dedicated audio server (${codec}, internal system output) on port ${audioPort} [scid=${scidHex}]...`);
      const proc = spawn(ADB_BIN, audioArgs, { windowsHide: true });
      this._audioProc = proc;

      let isReady = false;
      const readyPromise = new Promise((resolve) => {
        const onData = (d) => {
          const msg = d.toString().trim();
          if (msg) {
            logger.info(`[ScrcpyAudio ${this.serial}] ${msg}`);
            this._audioDebugLogs.push(`[${new Date().toISOString()}] ${msg}`);
            if (this._audioDebugLogs.length > 50) this._audioDebugLogs.shift();
          }
          if (msg.includes('Device:') || msg.includes('Audio') || msg.includes('[server]')) {
            if (!isReady) { isReady = true; resolve(); }
          }
        };
        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);
        setTimeout(() => {
          if (!isReady) { isReady = true; resolve(); }
        }, 2200);
      });

      proc.on('close', (code) => {
        logger.info(`[ScrcpyAudio ${this.serial}] Dedicated audio process closed (code: ${code})`);
        this._audioProc = null;
        if (this.audioSocket) {
          try { this.audioSocket.destroy(); } catch (_) {}
          this.audioSocket = null;
        }
        if (!this.isRunning || !this.enableAudio) return;

        // Adaptive fallback ladder for pure internal digital audio:
        // 1. opus (output) -> 2. aac (output) -> 3. raw (output)
        // (Never fall back to room mic, preventing static/ambient noise and cross-talk between phones)
        if (codec === 'opus') {
          logger.info(`[ScrcpyAudio ${this.serial}] Falling back from opus to aac audio encoder...`);
          setTimeout(() => this._startDedicatedAudioStream('aac', 'output'), 1000);
        } else if (codec === 'aac') {
          logger.info(`[ScrcpyAudio ${this.serial}] Falling back from aac to raw PCM audio...`);
          setTimeout(() => this._startDedicatedAudioStream('raw', 'output'), 1000);
        } else {
          // Cooldown and retry opus internal output
          setTimeout(() => {
            if (this.isRunning && !this._audioProc) {
              this._startDedicatedAudioStream('opus', 'output');
            }
          }, 8000);
        }
      });

      await readyPromise;
      if (!this.isRunning || !this._audioProc) return;

      // Small delay to ensure Android abstract socket is open
      await new Promise(r => setTimeout(r, 200));
      this.audioSocket = await this._connectOne(audioPort, 25);
      this.audioSocket.setNoDelay(true);
      this._pipeAudioToClients(this.audioSocket, audioPort, codec, audioSource);
      logger.info(`[ScrcpyEngine ${this.serial}] Dedicated audio stream active on port ${audioPort}`);

    } catch (err) {
      logger.warn(`[ScrcpyEngine ${this.serial}] Dedicated audio notice: ${err.message} (video & control unaffected)`);
      if (this._audioProc) {
        try { this._audioProc.kill(); } catch (_) {}
        this._audioProc = null;
      }
      if (codec === 'opus' && this.isRunning) {
        setTimeout(() => this._startDedicatedAudioStream('aac', 'playback'), 1500);
      } else if (codec === 'aac' && this.isRunning) {
        setTimeout(() => this._startDedicatedAudioStream('raw', 'playback'), 1500);
      }
    }
  }

  _reconnectAudioSocket(audioPort, codec, audioSource) {
    if (!this.isRunning || !this._audioProc || this.audioSocket) return;
    this._connectOne(audioPort, 15)
      .then((s) => {
        if (!this.isRunning || !this._audioProc) {
          try { s.destroy(); } catch (_) {}
          return;
        }
        this.audioSocket = s;
        this.audioSocket.setNoDelay(true);
        this._pipeAudioToClients(this.audioSocket, audioPort, codec, audioSource);
        logger.info(`[ScrcpyEngine ${this.serial}] Reconnected dedicated audio socket on port ${audioPort}`);
      })
      .catch((err) => {
        logger.warn(`[ScrcpyEngine ${this.serial}] Audio socket reconnect notice: ${err.message}`);
      });
  }

  _connectOne(port, retries = 50) {
    return new Promise((resolve, reject) => {
      const attempt = (n) => {
        const s = net.connect({ port, host: '127.0.0.1' }, () => resolve(s));
        s.on('error', (e) => {
          s.destroy();
          if (n <= 0) return reject(new Error(`Timeout connecting to port ${port}: ${e.message}`));
          setTimeout(() => attempt(n - 1), 150);
        });
      };
      attempt(retries);
    });
  }

  /**
   * Relay raw H264 NAL units from the video socket to all WS clients.
   * Zero-copy buffer slicing & minimal latency stream pipeline.
   */
  _pipeVideoToClients(socket) {
    let buf = Buffer.alloc(0);
    let headerDone = false;
    this.lastDataTime = Date.now();
    const DEVICE_HEADER_LEN = 77;
    const META = 12; // 8-byte PTS + 4-byte size

    const watchdog = setInterval(() => {
      // Only capture instant screencap if video socket is NOT connected or active,
      // avoiding injecting disruptive PNG frames and waking screen while H.264 pipeline is alive.
      if ((!this.videoSocket || this.videoSocket.destroyed) && this.isRunning && this.wsClients.size > 0) {
        this.captureInstantFrame();
      }
      // Only trigger fallback if video socket is destroyed or disconnected
      if ((!this.videoSocket || this.videoSocket.destroyed) && !this._fallbackActive && this.isRunning) {
        logger.warn(`[ScrcpyEngine ${this.serial}] Video socket disconnected — starting screenrecord fallback`);
        this._startScreenrecordFallback();
      }
    }, 2000);

    socket.on('data', (chunk) => {
      this.lastDataTime = Date.now();
      buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);

      // 1. Skip the device-info header exactly once & parse real video stream size
      if (!headerDone) {
        let headerLen = 0;
        const hIdx = buf.indexOf(Buffer.from('h264'));
        if (hIdx >= 0 && buf.length >= hIdx + 12) {
          headerLen = hIdx + 12; // Scrcpy 2.4 header: dummy(1) + name(64) + 'h264'(4) + width(4) + height(4) = 77 bytes
          try {
            const w = buf.readUInt32BE(hIdx + 4);
            const h = buf.readUInt32BE(hIdx + 8);
            if (w > 0 && h > 0 && w < 10000 && h < 10000) {
              this.scrcpyVideoWidth = w;
              this.scrcpyVideoHeight = h;
              this.videoWidth = w;
              this.videoHeight = h;
              logger.info(`[ScrcpyEngine ${this.serial}] Scrcpy stream resolution: ${w}x${h}`);
            }
          } catch (_) {}
        } else if (buf.length >= 77 && buf[0] === 0x00) {
          headerLen = 77;
          try {
            const w = buf.readUInt32BE(69);
            const h = buf.readUInt32BE(73);
            if (w > 0 && h > 0 && w < 10000 && h < 10000) {
              this.scrcpyVideoWidth = w;
              this.scrcpyVideoHeight = h;
              this.videoWidth = w;
              this.videoHeight = h;
              logger.info(`[ScrcpyEngine ${this.serial}] Scrcpy stream resolution: ${w}x${h}`);
            }
          } catch (_) {}
        } else if (buf.length >= 1 && buf[0] === 0x00 && !buf.includes(Buffer.from('h264')) && buf.length < 77) {
          return; // Wait for full header bytes
        } else if (headerLen === 0 && buf.length >= 77) {
          headerLen = 77;
        }

        if (headerLen === 0) return; // Wait until full header is available

        buf = buf.subarray(headerLen);
        headerDone = true;
        logger.info(`[ScrcpyEngine ${this.serial}] Device-info header consumed (${headerLen} bytes), stream parsing started`);
      }

      // 2. Process video frame packets zero-copy
      while (buf.length >= META) {
        const pktSize = buf.readUInt32BE(8);
        if (pktSize === 0 || pktSize > 5 * 1024 * 1024) {
          // Framing recovery: seek to next NAL start code (0x00 0x00 0x01)
          const nextStart = buf.indexOf(Buffer.from([0, 0, 1]));
          if (nextStart >= 0) {
            buf = buf.subarray(Math.max(0, nextStart - (nextStart >= 1 && buf[nextStart-1] === 0 ? 1 : 0)));
          } else {
            buf = Buffer.alloc(0);
          }
          break;
        }

        if (buf.length < META + pktSize) break;

        const ptsHigh  = buf.readUInt32BE(0);
        const payload  = buf.subarray(META, META + pktSize);
        buf = buf.subarray(META + pktSize);

        const nalTypes = getNalUnitTypes(payload);
        const isSps = nalTypes.has(7);
        const isIdr = nalTypes.has(5);
        const isConfig = isSps || (ptsHigh & 0x80000000) !== 0;
        const isKeyframe = isConfig || isIdr || isSps || nalTypes.has(8);

        if (isSps || (isConfig && !this._configPacket)) {
          this._configPacket = Buffer.from(payload);

          // Parse true encoder dimensions directly from SPS NAL
          try {
            const spsW = parseSpsWidth(payload);
            const spsH = parseSpsHeight(payload);
            if (spsW > 16 && spsH > 16 && spsW < 10000 && spsH < 10000) {
              const prevW = this.scrcpyVideoWidth;
              const prevH = this.scrcpyVideoHeight;

              // Check if resolution or orientation genuinely changed.
              // Ignore micro-differences (<= 32px) like macroblock padding (e.g. 1604 vs 1616).
              const isOrientationFlip = prevW && prevH && ((prevW > prevH) !== (spsW > spsH));
              const isMajorDiff = prevW && prevH && (Math.abs(prevW - spsW) > 32 || Math.abs(prevH - spsH) > 32);
              const hasChanged = (!prevW || !prevH || isOrientationFlip || isMajorDiff);
              if (hasChanged) {
                let newW = spsW;
                let newH = spsH;
                if (isOrientationFlip && prevW && prevH) {
                  if (Math.abs(spsW - prevH) <= 32 && Math.abs(spsH - prevW) <= 32) {
                    newW = prevH;
                    newH = prevW;
                  }
                }
                this.scrcpyVideoWidth = newW;
                this.scrcpyVideoHeight = newH;
                this.videoWidth  = newW;
                this.videoHeight = newH;
                this._keyframeBuffer = null; // Clear old orientation keyframe cache
                logger.info(`[ScrcpyEngine ${this.serial}] Active video resolution updated: ${newW}x${newH} (prev: ${prevW}x${prevH})`);

                // Broadcast resolution change to all connected WebSocket clients
                const changeMsg = Buffer.from(JSON.stringify({
                  type: 'resolution_change',
                  width: newW,
                  height: newH,
                }));
                for (const ws of this.wsClients) {
                  if (ws.readyState === 1) {
                    try { ws.send(changeMsg); } catch (_) {}
                  }
                }
              }
            }
          } catch (err) {
            logger.warn(`[ScrcpyEngine ${this.serial}] SPS parse error: ${err.message}`);
          }
        }

        let broadcastPkt = payload;
        if (isIdr || (isKeyframe && !isConfig)) {
          this._keyframeTime = Date.now();
          if (this._configPacket && !isSps) {
            // Always prepend SPS/PPS config to IDR slice so every keyframe is 100% self-contained for WebCodecs
            this._keyframeBuffer = Buffer.concat([this._configPacket, payload]);
            broadcastPkt = this._keyframeBuffer;
          } else {
            this._keyframeBuffer = Buffer.from(payload);
          }
        }

        this._lastVideoPayload = broadcastPkt;
        this._broadcastVideo(broadcastPkt, isKeyframe);
      }

      // Safety reset
      if (buf.length > 1024 * 1024) {
        logger.warn(`[ScrcpyEngine ${this.serial}] Buffer overflow — resetting`);
        buf = Buffer.alloc(0);
      }
    });

    socket.on('close', () => {
      clearInterval(watchdog);
      logger.warn(`[ScrcpyEngine ${this.serial}] Video socket closed`);
      this.videoSocket = null;
      if (this.isRunning && !this._fallbackActive) {
        this._startScreenrecordFallback();
      }
    });

    socket.on('error', (e) => {
      clearInterval(watchdog);
      logger.warn(`[ScrcpyEngine ${this.serial}] Video socket error: ${e.message}`);
      this.videoSocket = null;
    });
  }

  _pipeAudioToClients(socket, audioPort, expectedCodec, audioSource) {
    let buf = Buffer.alloc(0);
    let headerDone = false;

    socket.on('data', (chunk) => {
      buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);

      if (!headerDone) {
        // Scrcpy sends 4-byte codec ID (e.g. "opus", "raw ", "aac "),
        // optionally preceded by 0x00 dummy byte if send_dummy_byte was true.
        let offset = 0;
        if (buf.length > 0 && buf[0] === 0x00) offset = 1;
        if (buf.length < offset + 4) return;

        const rawCodecStr = buf.toString('latin1', offset, offset + 4).toLowerCase().replace(/\0/g, '').trim();
        logger.info(`[ScrcpyEngine ${this.serial}] Audio codec header detected: "${rawCodecStr}"`);
        if (rawCodecStr.includes('opus')) {
          this._audioCodec = 'opus';
        } else if (rawCodecStr.includes('aac')) {
          this._audioCodec = 'aac';
        } else if (rawCodecStr.includes('raw')) {
          this._audioCodec = 'raw';
        } else {
          this._audioCodec = expectedCodec || 'opus';
        }
        buf = buf.subarray(offset + 4);
        headerDone = true;
      }

      const META = 12; // 8-byte PTS/flags + 4-byte size
      while (buf.length >= META) {
        const pktSize = buf.readUInt32BE(8);
        if (pktSize === 0) {
          buf = buf.subarray(META);
          continue;
        }
        if (pktSize > 512 * 1024) {
          // Desync guard: discard 1 byte and search for framing
          buf = buf.subarray(1);
          continue;
        }
        if (buf.length < META + pktSize) break;

        // Bit 63 of 64-bit PTS is the config packet flag
        const isConfig = (buf[0] & 0x80) !== 0;
        const payload = buf.subarray(META, META + pktSize);
        buf = buf.subarray(META + pktSize);

        this._broadcastAudio(payload, isConfig);
      }
    });

    socket.on('close', () => {
      logger.info(`[ScrcpyAudio ${this.serial}] Dedicated audio socket closed`);
      this.audioSocket = null;
      if (this.isRunning && this._audioProc) {
        setTimeout(() => this._reconnectAudioSocket(audioPort, expectedCodec, audioSource), 1000);
      }
    });

    socket.on('error', (e) => {
      logger.warn(`[ScrcpyEngine ${this.serial}] Audio socket error: ${e.message}`);
      this.audioSocket = null;
    });
  }

  _broadcastAudio(payload, isConfig = false) {
    // Frame layout: [0x41][codec_byte][flags_byte][...payload]
    // 0x41 = 'A' (audio tag)
    // codec: 0x4F ('O' = opus), 0x43 ('C' = aac), 0x52 ('R' = raw PCM)
    // flags: 0x01 (config packet), 0x00 (audio data)
    let codecByte = 0x4F; // 'O'
    if (this._audioCodec === 'aac') codecByte = 0x43; // 'C'
    else if (this._audioCodec === 'raw') codecByte = 0x52; // 'R'

    const audioFrame = Buffer.allocUnsafe(3 + payload.length);
    audioFrame[0] = 0x41; // 'A'
    audioFrame[1] = codecByte;
    audioFrame[2] = isConfig ? 0x01 : 0x00;
    payload.copy(audioFrame, 3);
    this._audioPacketsSent = (this._audioPacketsSent || 0) + 1;

    for (const ws of this.wsClients) {
      if (ws.readyState === 1 && ws.bufferedAmount < 128 * 1024) {
        try { ws.send(audioFrame, { binary: true }); } catch (_) {}
      }
    }
  }

  _broadcastVideo(payload, isKeyframe = false) {
    for (const ws of this.wsClients) {
      if (ws.readyState === 1) {
        // Backpressure protection: only throttle if socket buffer exceeds 384KB
        if (ws.bufferedAmount > 384 * 1024) {
          ws._needsKeyframe = true;
          continue;
        }
        if (ws._needsKeyframe) {
          // If buffered amount drained, wait for a FRESH real keyframe from the encoder
          // Never inject stale cached frames from earlier screens!
          if (!isKeyframe) {
            continue;
          }
          ws._needsKeyframe = false;
        }
        try { ws.send(payload, { binary: true }); } catch (_) { this.wsClients.delete(ws); }
      } else {
        this.wsClients.delete(ws);
      }
    }
  }

  /**
   * Simple, reliable screencap streaming.
   * Captures PNG screenshots continuously and sends as base64 to clients.
   * ~10-15 fps, works on all devices, no codec issues.
   */
  _startScreencapStream() {
    if (this._screencapActive) return;
    this._screencapActive = true;

    const captureLoop = async () => {
      while (this._screencapActive && this.isRunning) {
        try {
          const startTime = Date.now();
          
          // Capture screenshot
          const proc = spawn(ADB_BIN, ['-s', this.serial, 'exec-out', 'screencap -p'], {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore']
          });

          const chunks = [];
          proc.stdout.on('data', c => chunks.push(c));
          
          await new Promise((resolve) => {
            proc.on('close', () => resolve());
            proc.on('error', () => resolve());
          });

          if (chunks.length > 0) {
            // exec-out via spawn stdio:pipe delivers clean binary — no CRLF stripping needed
            const pngData = Buffer.concat(chunks);
            
            // Send to all connected clients
            for (const ws of this.wsClients) {
              if (ws.readyState === 1) {
                try {
                  ws.send(pngData, { binary: true });
                } catch (_) {
                  this.wsClients.delete(ws);
                }
              } else {
                this.wsClients.delete(ws);
              }
            }
          }

          // Maintain ~15 fps (67ms per frame)
          const elapsed = Date.now() - startTime;
          const delay = Math.max(1, 67 - elapsed);
          await new Promise(r => setTimeout(r, delay));

        } catch (err) {
          logger.warn(`[ScrcpyEngine ${this.serial}] Screencap error: ${err.message}`);
          await new Promise(r => setTimeout(r, 100));
        }
      }
    };

    captureLoop();
    logger.info(`[ScrcpyEngine ${this.serial}] Screencap streaming started`);
  }

  // ── Control protocol ──────────────────────────────────────────────────────

  /**
   * INJECT_TOUCH_EVENT (32 bytes, scrcpy 2.x)
   *   [0]     msg type = 2
   *   [1]     action: 0=DOWN 1=UP 2=MOVE
   *   [2-9]   pointer id i64BE (-1 = virtual)
   *   [10-13] x i32BE
   *   [14-17] y i32BE
   *   [18-19] screen width u16BE
   *   [20-21] screen height u16BE
   *   [22-23] pressure u16BE (0xFFFF = 1.0)
   *   [24-27] action_button i32BE (1=PRIMARY on DOWN)
   *   [28-31] buttons i32BE (1 on DOWN/MOVE, 0 on UP)
   */
  sendTouchEvent(action, x, y, width, height, pressure = 1.0) {
    this._keyframeBuffer = null; // Active interaction invalidates any older keyframe
    let targetW = this.scrcpyVideoWidth || this.videoWidth;
    let targetH = this.scrcpyVideoHeight || this.videoHeight;
    if (!targetW || !targetH) {
      targetW = (width > 10) ? Math.round(width) : (this.screenWidth || 1080);
      targetH = (height > 10) ? Math.round(height) : (this.screenHeight || 2340);
    }

    const srcW = (width  > 10) ? width  : targetW;
    const srcH = (height > 10) ? height : targetH;
    
    const scaledX = Math.round((x / srcW) * targetW);
    const scaledY = Math.round((y / srcH) * targetH);

    // Clamp to valid range
    const finalX = Math.max(0, Math.min(targetW - 1, scaledX));
    const finalY = Math.max(0, Math.min(targetH - 1, scaledY));

    if (!this.controlSocket || this.controlSocket.destroyed) {
      if (action === 0 || action === 1) {
        const physX = Math.round((finalX / targetW) * this.screenWidth);
        const physY = Math.round((finalY / targetH) * this.screenHeight);
        this._adb(['shell', 'input', 'tap', String(physX), String(physY)]).catch(() => {});
      }
      return false;
    }

    const normPressure = (action === 1) ? 0 : Math.min(0xffff, Math.max(1, Math.floor((pressure || 0.5) * 65535)));

    const buf = Buffer.allocUnsafe(32);
    buf.writeUInt8(2, 0);                 // INJECT_TOUCH_EVENT
    buf.writeUInt8(action, 1);            // 0=DOWN, 1=UP, 2=MOVE
    buf.writeBigInt64BE(-2n, 2);          // SC_POINTER_ID_GENERIC_FINGER (-2n)
    buf.writeInt32BE(finalX, 10);
    buf.writeInt32BE(finalY, 14);
    buf.writeUInt16BE(targetW, 18);
    buf.writeUInt16BE(targetH, 20);
    buf.writeUInt16BE(normPressure, 22);
    buf.writeInt32BE(0, 24);              // action_button = 0
    buf.writeInt32BE(0, 28);              // buttons = 0 (clean touchscreen finger event)
    try {
      this.controlSocket.write(buf);
      return true;
    } catch (e) { 
      logger.warn(`[ScrcpyEngine ${this.serial}] touch write failed: ${e.message}`);
      if (action === 0 || action === 1) {
        const physX = Math.round((finalX / targetW) * this.screenWidth);
        const physY = Math.round((finalY / targetH) * this.screenHeight);
        this._adb(['shell', 'input', 'tap', String(physX), String(physY)]).catch(() => {});
      }
      return false; 
    }
  }

  /**
   * INJECT_KEYCODE (14 bytes)
   *   [0]     msg type = 0
   *   [1]     action 0=DOWN 1=UP
   *   [2-5]   keycode i32BE
   *   [6-9]   repeat i32BE
   *   [10-13] metastate i32BE
   */
  sendKeycode(action, keycode, repeat = 0, metastate = 0) {
    if (!this.controlSocket || this.controlSocket.destroyed) {
      if (action === 0) {
        this._adb(['shell', 'input', 'keyevent', String(keycode)]).catch(() => {});
      }
      return false;
    }
    const buf = Buffer.allocUnsafe(14);
    buf.writeUInt8(0, 0);
    buf.writeUInt8(action, 1);
    buf.writeInt32BE(keycode, 2);
    buf.writeInt32BE(repeat, 6);
    buf.writeInt32BE(metastate, 10);
    try { 
      this.controlSocket.write(buf); 
      return true; 
    } catch (_) {
      if (action === 0) {
        this._adb(['shell', 'input', 'keyevent', String(keycode)]).catch(() => {});
      }
      return false; 
    }
  }

  /**
   * INJECT_TEXT (variable)
   *   [0]     msg type = 1
   *   [1-4]   text length i32BE
   *   [5...]  UTF-8 text
   */
  sendText(text) {
    if (!this.controlSocket || this.controlSocket.destroyed) {
      const escaped = text.replace(/(["'`$\\!& |;()<>])/g, '\\$1');
      this._adb(['shell', 'input', 'text', escaped]).catch(() => {});
      return false;
    }
    const tb = Buffer.from(text, 'utf-8');
    const buf = Buffer.allocUnsafe(5 + tb.length);
    buf.writeUInt8(1, 0);
    buf.writeInt32BE(tb.length, 1);
    tb.copy(buf, 5);
    try { 
      this.controlSocket.write(buf); 
      return true; 
    } catch (_) {
      const escaped = text.replace(/(["'`$\\!& |;()<>])/g, '\\$1');
      this._adb(['shell', 'input', 'text', escaped]).catch(() => {});
      return false; 
    }
  }

  // ── Reconnect / restart ───────────────────────────────────────────────────

  async _reconnectControl() {
    if (!this.isRunning) return;
    try {
      const cs = await this._connectOne(this.videoPort, 10);
      cs.setNoDelay(true);
      cs.setKeepAlive(true, 1000);
      this.controlSocket = cs;
      cs.on('close', () => {
        this.controlSocket = null;
        if (this.isRunning) setTimeout(() => this._reconnectControl(), 300);
      });
      cs.on('error', () => { this.controlSocket = null; });
    } catch (_) {
      if (this.isRunning) setTimeout(() => this._reconnectControl(), 1000);
    }
  }

  // ── Reset stream state on restart ────────────────────────────────────────
  _resetStreamState() {
    this._configPacket   = null;
    this._keyframeBuffer = null;
    // Notify all connected browsers to reset their decoders
    const resetMsg = Buffer.from(JSON.stringify({ type: 'stream_reset' }));
    for (const ws of this.wsClients) {
      if (ws.readyState === 1) {
        try { ws.send(resetMsg); } catch (_) {}
      }
    }
  }

  async _restart() {
    if (!this.isRunning) return;
    logger.info(`[ScrcpyEngine ${this.serial}] Restarting...`);
    // Clear stale keyframe cache so fresh SPS/PPS+IDR are sent after restart
    this._configPacket   = null;
    this._keyframeBuffer = null;
    this._restartPending = false;
    // Tell connected browsers to reset their decoders before new stream data arrives
    const resetMsg = Buffer.from(JSON.stringify({ type: 'stream_reset' }));
    for (const ws of this.wsClients) {
      if (ws.readyState === 1) try { ws.send(resetMsg); } catch (_) {}
    }
    try {
      // Force-kill any lingering scrcpy/app_process on device to release localabstract:scrcpy
      try {
        await this._adb(['shell', 'pkill', '-9', '-f', 'com.genymobile.scrcpy']).catch(() => {});
        await new Promise(r => setTimeout(r, 200));
      } catch (_) {}

      try { await this._adb(['forward', '--remove', `tcp:${this.videoPort}`]); } catch (_) {}
      await this._adb(['forward', `tcp:${this.videoPort}`, 'localabstract:scrcpy']);
      this._spawnServer();
      await this._connectSockets();
      logger.info(`[ScrcpyEngine ${this.serial}] Restarted successfully`);
    } catch (err) {
      logger.warn(`[ScrcpyEngine ${this.serial}] Restart failed: ${err.message} — retry in 3s`);
      if (this.isRunning) setTimeout(() => this._restart(), 3000);
    }
  }

  _adb(args) {
    return new Promise((resolve, reject) => {
      execFile(ADB_BIN, ['-s', this.serial, ...args], { timeout: 10000 }, (err, stdout) => {
        if (err) reject(err); else resolve(stdout || '');
      });
    });
  }
}

module.exports = ScrcpyEngine;
