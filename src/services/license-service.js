'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../utils/logger');

// ─── DNS-over-HTTPS (DoH) Client ──────────────────────────────────────────
// Prevent survey apps from analyzing DNS queries to detect infrastructure
class DoHClient {
  constructor() {
    // Rotate between multiple DoH providers to avoid single-point detection
    this.providers = [
      'https://1.1.1.1/dns-query',           // Cloudflare
      'https://8.8.8.8/dns-query',           // Google
      'https://dns.nextdns.io/dns-query',    // NextDNS (privacy-focused)
    ];
    this.currentProvider = 0;
  }
  
  async resolve(hostname) {
    try {
      const provider = this.providers[this.currentProvider];
      this.currentProvider = (this.currentProvider + 1) % this.providers.length;
      
      const response = await axios.get(provider, {
        params: {
          name: hostname,
          type: 'A',
        },
        headers: {
          'Accept': 'application/dns-json',
          // Randomize User-Agent per request
          'User-Agent': this._randomUserAgent(),
        },
        timeout: 5000,
      });
      
      if (response.data.Answer && response.data.Answer.length > 0) {
        return response.data.Answer[0].data;
      }
      return null;
    } catch (err) {
      logger.warn(`[ProxyService] DNS resolution failed for ${hostname}`);
      return null;
    }
  }
  
  _randomUserAgent() {
    const agents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    ];
    return agents[Math.floor(Math.random() * agents.length)];
  }
}

const dohClient = new DoHClient();

// ─── Config ──────────────────────────────────────────────────────────────────

function loadConfig() {
  for (const p of [
    path.join(process.cwd(), 'config.json'),
    path.join(__dirname, '..', '..', 'config.json'),
  ]) {
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (_) {}
    }
  }
  return {};
}

function saveConfig(cfg) {
  const p = path.join(process.cwd(), 'config.json');
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf-8');
}

// ─── Cache ────────────────────────────────────────────────────────────────────

// 2 Days Cache TTL (48 hours = 172,800,000 ms)
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const LICENSE_CACHE_FILE = path.join(process.cwd(), 'license_cache.json');

const licenseCache = new Map();
const ROTATED_STREAM_KEYS = new Map(); // Map<serial, rotated16CharKey>
const ROTATED_STREAM_PINS = new Map(); // Map<serial, rotated6DigitPin>
const lastDeviceSyncState = new Map(); // Map<serial, { signature: string, at: number }>

// Load persistent disk cache if present
try {
  if (fs.existsSync(LICENSE_CACHE_FILE)) {
    const rawDisk = JSON.parse(fs.readFileSync(LICENSE_CACHE_FILE, 'utf-8'));
    for (const [code, entry] of Object.entries(rawDisk)) {
      if (entry && entry.value && entry.at && (Date.now() - entry.at < TWO_DAYS_MS)) {
        licenseCache.set(code, entry);
      }
    }
  }
} catch (_) {}

function saveDiskLicenseCache() {
  try {
    const obj = {};
    for (const [code, entry] of licenseCache.entries()) {
      obj[code] = entry;
    }
    fs.writeFileSync(LICENSE_CACHE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (_) {}
}

function getRotatedStreamKey(serial) {
  return ROTATED_STREAM_KEYS.get(serial) || null;
}

function setRotatedStreamKey(serial, key) {
  if (serial && key) {
    ROTATED_STREAM_KEYS.set(serial, key);
  }
}

function getRotatedStreamPin(serial) {
  return ROTATED_STREAM_PINS.get(serial) || null;
}

function setRotatedStreamPin(serial, pin) {
  if (serial && pin) {
    ROTATED_STREAM_PINS.set(serial, pin);
  }
}

const security = require('../utils/security');

function getSupabaseClient() {
  const creds = (security && typeof security.getDecryptedSystemCredentials === 'function')
    ? security.getDecryptedSystemCredentials()
    : {};
  const cfg = loadConfig();
  const url = process.env.SUPABASE_URL || cfg.supabaseUrl || creds.supabaseUrl;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || cfg.supabaseServiceRoleKey || cfg.supabaseAnonKey || creds.supabaseServiceRoleKey || creds.supabaseAnonKey;
  
  if (!url || !key) return null;
  return axios.create({
    baseURL: `${url.replace(/\/$/, '')}/rest/v1`,
    timeout: 8000,
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
}

// ─── License check (Checked every 2 days to minimize egress) ─────────────────

/**
 * Check if the local machine binding is licensed and active.
 * Cached locally for 48 hours to keep Supabase egress near zero.
 * Returns { isActive, mode, bindingCode, note }
 */
async function checkLicenseStatus(bindingCode) {
  const cached = licenseCache.get(bindingCode);
  if (cached && Date.now() - cached.at < TWO_DAYS_MS) {
    return cached.value;
  }

  const client = getSupabaseClient();

  // If Supabase not configured — standalone / free mode
  if (!client) {
    const result = { isActive: true, mode: 'standalone', bindingCode, note: 'No Supabase configured — standalone mode' };
    licenseCache.set(bindingCode, { value: result, at: Date.now() });
    saveDiskLicenseCache();
    return result;
  }

  try {
    // Only query required columns to minimize egress
    const res = await client.get(
      `/machine_bindings?binding_code=eq.${encodeURIComponent(bindingCode)}&select=is_licensed,license_mode,license_note&limit=1`
    );
    const rows = res.data;

    if (!rows || rows.length === 0) {
      // No binding record yet in cloud — treat as free/active
      const result = { isActive: true, mode: 'free', bindingCode, note: 'Unbound machine — active free mode' };
      licenseCache.set(bindingCode, { value: result, at: Date.now() });
      saveDiskLicenseCache();
      return result;
    }

    const lic = rows[0];
    const isActive = lic.is_licensed !== false;
    const result = {
      isActive,
      mode: lic.license_mode || 'licensed',
      bindingCode,
      note: isActive ? 'Licensed and active' : ('Revoked: ' + (lic.license_note || 'License revoked by seed admin')),
    };
    licenseCache.set(bindingCode, { value: result, at: Date.now() });
    saveDiskLicenseCache();
    return result;
  } catch (err) {
    logger.warn(`[LicenseService] License check note for ${bindingCode}: ${err.message}`);
    const result = { isActive: true, mode: 'offline_grace', bindingCode, note: 'Supabase notice — active grace mode' };
    licenseCache.set(bindingCode, { value: result, at: Date.now() });
    saveDiskLicenseCache();
    return result;
  }
}

/**
 * Sync device info to Supabase devices & device_rentals tables.
 * Called when a device connects or its stream URL changes.
 */
async function syncDeviceToCloud(params) {
  const { serial, model, brand, streamUrl, localUrl, port, bindingCode, status } = params;
  const client = getSupabaseClient();
  if (!client) return;

  const syncSignature = `${serial}:${model || ''}:${brand || ''}:${streamUrl || ''}:${localUrl || ''}:${port || ''}:${bindingCode || ''}:${status || ''}`;
  const lastState = lastDeviceSyncState.get(serial);
  // Skip redundant cloud sync if device state hasn't changed and synced in the last 15 minutes
  if (lastState && lastState.signature === syncSignature && (Date.now() - lastState.at < 15 * 60 * 1000)) {
    return;
  }

  try {
    let finalStreamUrl = streamUrl || null;

    // Check if an existing rotated stream_url with key= or pin= exists in Supabase for this device
    try {
      const exRes = await client.get(`/devices?serial=eq.${encodeURIComponent(serial)}&select=stream_url`);
      if (exRes.data && Array.isArray(exRes.data) && exRes.data.length > 0 && exRes.data[0].stream_url) {
        const dbUrl = exRes.data[0].stream_url;
        if (dbUrl.includes('key=')) {
          finalStreamUrl = dbUrl;
          const matchKey = dbUrl.match(/key=([^&]+)/);
          if (matchKey && matchKey[1]) {
            ROTATED_STREAM_KEYS.set(serial, matchKey[1]);
          }
        }
        if (dbUrl.includes('pin=')) {
          const matchPin = dbUrl.match(/pin=([^&]+)/);
          if (matchPin && matchPin[1]) {
            ROTATED_STREAM_PINS.set(serial, matchPin[1]);
          }
        }
      }
    } catch (_) {}

    // 1. Sync to public.devices table (used by website dashboards)
    const devicesPayload = {
      serial,
      model: model || 'Android Device',
      brand: brand || 'Generic',
      stream_url: finalStreamUrl,
      local_url: localUrl || null,
      port: port || null,
      binding_code: bindingCode || null,
      status: status || 'online',
      is_deleted_from_view: false, // Ensure active connected devices are visible in admin dashboards
      last_seen: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await client.post('/devices?on_conflict=serial', devicesPayload, {
      headers: { Prefer: 'resolution=merge-duplicates' },
    });

    // 2. Check machine_bindings to find owner user_id if machine is bound to a user account
    let ownerUserId = 'RENTAL_USER_DEFAULT';
    if (bindingCode) {
      try {
        const mbRes = await client.get(`/machine_bindings?binding_code=eq.${encodeURIComponent(bindingCode)}&select=user_id`);
        if (mbRes.data && Array.isArray(mbRes.data) && mbRes.data.length > 0 && mbRes.data[0].user_id) {
          ownerUserId = mbRes.data[0].user_id;
        }
      } catch (_) {}
    }

    // 3. Sync to public.device_rentals table (used by netlify admin portal & rental hub)
    try {
      const rentalPatchPayload = {
        device_model: model || 'Android Device',
        device_brand: brand || 'Generic',
        binding_code: bindingCode || null,
        updated_at: new Date().toISOString(),
      };
      if (finalStreamUrl) rentalPatchPayload.stream_url = finalStreamUrl;

      const patchRes = await client.patch(
        `/device_rentals?serial_number=eq.${encodeURIComponent(serial)}`,
        rentalPatchPayload,
        { headers: { Prefer: 'return=representation' } }
      );

      if (!patchRes.data || !Array.isArray(patchRes.data) || patchRes.data.length === 0) {
        // New device serial — insert into device_rentals so admin portals always match local ADB device count
        await client.post('/device_rentals', {
          serial_number: serial,
          user_id: ownerUserId,
          device_model: model || 'Android Device',
          device_brand: brand || 'Generic',
          binding_code: bindingCode || null,
          stream_url: finalStreamUrl,
          monthly_fee: 30,
          currency: 'USD',
          status: 'active',
          updated_at: new Date().toISOString(),
        });
        logger.info(`[LicenseService] Device ${serial} newly registered in device_rentals cloud table`);
      }
    } catch (rentalErr) {
      logger.warn(`[LicenseService] device_rentals sync notice for ${serial}: ${rentalErr.message}`);
    }

    lastDeviceSyncState.set(serial, { signature: syncSignature, at: Date.now() });
    logger.info(`[LicenseService] Device ${serial} synced to cloud (devices & device_rentals updated, url: ${finalStreamUrl})`);
  } catch (err) {
    logger.warn(`[LicenseService] Device sync notice for ${serial}: ${err.message}`);
  }
}

/**
 * Mark device as offline in Supabase across devices & device_rentals tables.
 */
async function markDeviceOffline(serial) {
  const client = getSupabaseClient();
  if (!client) return;
  try {
    await client.patch(
      `/devices?serial=eq.${encodeURIComponent(serial)}`,
      { status: 'offline', updated_at: new Date().toISOString() },
      { headers: { Prefer: 'return=minimal' } }
    );
  } catch (_) {}
  try {
    await client.patch(
      `/device_rentals?serial_number=eq.${encodeURIComponent(serial)}`,
      { updated_at: new Date().toISOString() },
      { headers: { Prefer: 'return=minimal' } }
    );
  } catch (_) {}
}

const devicePinCache = new Map(); // Map<serial, { pins: Set<string>, keys: Set<string>, at: number }>

/**
 * Validate a user PIN or key for a device with multi-source fallback:
 * 1. Hardware Binding Code (full 8-digit or last 4-digit)
 * 2. In-memory rotated key / pin
 * 3. Supabase device_assignments table (access_password) & devices table (stream_url)
 */
async function validateDevicePin(serial, rawInputPin, bindingCode) {
  if (!rawInputPin) return false;
  const pin = String(rawInputPin).trim().replace(/[^a-zA-Z0-9]/g, '');
  if (!pin) return false;

  // 1. Direct match with hardware binding code or last 4 digits
  if (bindingCode) {
    const cleanBinding = String(bindingCode).trim();
    if (pin === cleanBinding || pin === cleanBinding.slice(-4)) return true;
  }

  // 2. Direct match with in-memory rotated key / pin
  const memKey = ROTATED_STREAM_KEYS.get(serial);
  const memPin = ROTATED_STREAM_PINS.get(serial);
  if (memPin && pin === String(memPin).trim()) return true;
  if (memKey && pin === String(memKey).trim()) return true;

  // 3. Check cached pins from Supabase (valid for 30 seconds)
  const cached = devicePinCache.get(serial);
  if (cached && (Date.now() - cached.at < 30000)) {
    if (cached.pins.has(pin) || cached.keys.has(pin)) return true;
  }

  // 4. Query Supabase for assigned PINs and rotated URL keys
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    const validPins = new Set();
    const validKeys = new Set();

    // Query devices table for stream_url keys/pins
    const devRes = await client.get(`/devices?serial=eq.${encodeURIComponent(serial)}&select=id,stream_url`);
    let devId = null;
    if (devRes.data && Array.isArray(devRes.data) && devRes.data.length > 0) {
      devId = devRes.data[0].id;
      const urlStr = devRes.data[0].stream_url || '';
      const kMatch = urlStr.match(/key=([^&]+)/);
      const pMatch = urlStr.match(/pin=([^&]+)/);
      if (kMatch) {
        const k = kMatch[1].trim();
        validKeys.add(k);
        ROTATED_STREAM_KEYS.set(serial, k);
      }
      if (pMatch) {
        const p = pMatch[1].trim();
        validPins.add(p);
        ROTATED_STREAM_PINS.set(serial, p);
      }
    }

    // Query device_rentals table for stream_url keys/pins
    try {
      const rentalRes = await client.get(`/device_rentals?serial_number=eq.${encodeURIComponent(serial)}&select=stream_url`);
      if (rentalRes.data && Array.isArray(rentalRes.data)) {
        for (const row of rentalRes.data) {
          const u = row.stream_url || '';
          const kMatch = u.match(/key=([^&]+)/);
          const pMatch = u.match(/pin=([^&]+)/);
          if (kMatch) {
            const k = kMatch[1].trim();
            validKeys.add(k);
            ROTATED_STREAM_KEYS.set(serial, k);
          }
          if (pMatch) {
            const p = pMatch[1].trim();
            validPins.add(p);
            ROTATED_STREAM_PINS.set(serial, p);
          }
        }
      }
    } catch (_) {}

    // Query device_assignments table for access_password
    if (devId) {
      const assignRes = await client.get(`/device_assignments?device_id=eq.${encodeURIComponent(devId)}&select=access_password`);
      if (assignRes.data && Array.isArray(assignRes.data)) {
        for (const row of assignRes.data) {
          if (row.access_password) {
            const cleanP = String(row.access_password).trim();
            validPins.add(cleanP);
            ROTATED_STREAM_PINS.set(serial, cleanP);
          }
        }
      }
    }

    devicePinCache.set(serial, { pins: validPins, keys: validKeys, at: Date.now() });

    if (validPins.has(pin) || validKeys.has(pin)) {
      return true;
    }
  } catch (err) {
    logger.warn(`[LicenseService] PIN validation cloud check notice for ${serial}: ${err.message}`);
  }

  return false;
}

module.exports = {
  checkLicenseStatus,
  syncDeviceToCloud,
  markDeviceOffline,
  loadConfig,
  saveConfig,
  dohClient,
  getRotatedStreamKey,
  setRotatedStreamKey,
  getRotatedStreamPin,
  setRotatedStreamPin,
  validateDevicePin,
  getSupabaseClient,
};
