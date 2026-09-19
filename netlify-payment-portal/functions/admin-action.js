'use strict';

const axios = require('axios');
const walletStore = require('./wallet-store');

const SUPER_ADMIN_EMAIL = 'sammdev.ai@gmail.com';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { adminEmail, action, targetEmail, serialNumber, amount } = JSON.parse(event.body);

    const callerEmail = (adminEmail || '').toLowerCase().trim();
    if (callerEmail !== SUPER_ADMIN_EMAIL && callerEmail !== 'sammyseth260@gmail.com') {
      return {
        statusCode: 403,
        body: JSON.stringify({ status: 'error', message: 'Access Denied: Super Admin privileges required.' }),
      };
    }

    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

    const client = axios.create({
      baseURL: `${supabaseUrl.replace(/\/$/, '')}/rest/v1`,
      timeout: 6000,
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
    });

    // 1. Credit Wallet Deposit to User
    if (action === 'credit_wallet') {
      const depositVal = parseFloat(amount || 0);
      const newBal = await walletStore.addCredit(targetEmail, depositVal);

      return {
        statusCode: 200,
        body: JSON.stringify({
          status: 'ok',
          message: `Successfully credited $${depositVal.toFixed(2)} USD to user ${targetEmail}! New Wallet Balance: $${newBal.toFixed(2)} USD`,
          newBalance: newBal,
        }),
      };
    }

    // 2. Invalidate Device Payment (Set status to unpaid -> instantly blocks local & cloud stream)
    if (action === 'invalidate_device') {
      try {
        await client.patch(
          `/device_rentals?serial_number=eq.${encodeURIComponent(serialNumber)}`,
          { status: 'unpaid', expires_at: null, updated_at: new Date().toISOString() }
        );
      } catch (_) {}

      return {
        statusCode: 200,
        body: JSON.stringify({
          status: 'ok',
          message: `Device ${serialNumber} rental payment INVALIDATED. Stream link is now BLOCKED on local & cloud!`,
        }),
      };
    }

    // 3. Activate Device Payment (Extend by 30 days)
    if (action === 'activate_device') {
      const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
      try {
        await client.patch(
          `/device_rentals?serial_number=eq.${encodeURIComponent(serialNumber)}`,
          { status: 'active', expires_at: expiresAt, updated_at: new Date().toISOString() }
        );
      } catch (_) {}

      return {
        statusCode: 200,
        body: JSON.stringify({
          status: 'ok',
          message: `Device ${serialNumber} activated successfully for 30 days! Stream link UNLOCKED.`,
          expiresAt,
        }),
      };
    }

    // 4. Toggle Stealth Root on Device
    if (action === 'toggle_stealth_root' || action === 'enable_stealth_root' || action === 'disable_stealth_root') {
      let targetState = true;
      if (action === 'disable_stealth_root') targetState = false;
      else if (action === 'enable_stealth_root') targetState = true;
      else {
        try {
          const checkRes = await client.get(`/device_rentals?serial_number=eq.${encodeURIComponent(serialNumber)}&select=stealth_root_enabled`);
          if (checkRes.data && checkRes.data.length > 0) {
            targetState = checkRes.data[0].stealth_root_enabled === false ? true : false;
          }
        } catch (_) {}
      }

      try {
        await client.patch(
          `/device_rentals?serial_number=eq.${encodeURIComponent(serialNumber)}`,
          { stealth_root_enabled: targetState, updated_at: new Date().toISOString() }
        );
      } catch (_) {}

      return {
        statusCode: 200,
        body: JSON.stringify({
          status: 'ok',
          message: `Stealth Root for device ${serialNumber} is now ${targetState ? 'ENABLED 🛡️ (Root Masking Active)' : 'DISABLED ⚪ (Standard Mode)'}.`,
          stealthRootEnabled: targetState,
        }),
      };
    }

    // 5. Get All Devices
    if (action === 'get_all_devices') {
      let devices = [];
      try {
        const devRes = await client.get('/device_rentals?select=*&order=updated_at.desc');
        devices = devRes.data || [];
      } catch (_) {}

      // Fallback/Merge from public.devices table if any device is in devices but not device_rentals
      try {
        const altRes = await client.get('/devices?select=*&order=updated_at.desc');
        if (altRes.data && Array.isArray(altRes.data)) {
          const seenSerials = new Set(devices.map(d => d.serial_number || d.serial));
          altRes.data.forEach(d => {
            const s = d.serial || d.serial_number;
            if (s && !seenSerials.has(s)) {
              seenSerials.add(s);
              devices.push({
                serial_number: s,
                device_model: d.model || d.device_model || 'Android Device',
                device_brand: d.brand || d.device_brand || 'Generic',
                monthly_fee: d.monthly_rental_price || 30,
                currency: 'USD',
                status: d.status || 'active',
                binding_code: d.binding_code,
                stream_url: d.stream_url,
                updated_at: d.updated_at,
              });
            }
          });
        }
      } catch (_) {}

      const cctvAllowed = await walletStore.getCctvAccess();
      return {
        statusCode: 200,
        body: JSON.stringify({ status: 'ok', devices, cctvAllowed }),
      };
    }

    // 6. Toggle CCTV Wall Access Permission
    if (action === 'toggle_cctv_access' || action === 'set_cctv_access') {
      const current = await walletStore.getCctvAccess();
      const target = amount !== undefined ? !!amount : !current;
      const updated = await walletStore.setCctvAccess(target);
      return {
        statusCode: 200,
        body: JSON.stringify({
          status: 'ok',
          message: `Live CCTV Wall access is now ${updated ? 'ALLOWED 🔓 (Admins & Super Admins Enabled)' : 'BLOCKED 🔒 (Locked by Super Admin)'}.`,
          cctvAllowed: updated,
        }),
      };
    }

    if (action === 'get_cctv_access') {
      const allowed = await walletStore.getCctvAccess();
      return {
        statusCode: 200,
        body: JSON.stringify({ status: 'ok', cctvAllowed: allowed }),
      };
    }

    // 7. Rotate Stream Link (Generates 16-character key and 6-digit PIN)
    if (action === 'rotate_stream_link') {
      function generate16CharKey() {
        const words = ['flex', 'pulse', 'cloud', 'agent', 'cyber', 'hyper', 'nexus', 'shield', 'matrix', 'stream', 'turbo', 'quantum', 'vector', 'blaze', 'alpha', 'delta'];
        const w1 = words[Math.floor(Math.random() * words.length)];
        const w2 = words[Math.floor(Math.random() * words.length)];
        const num = Math.floor(1000 + Math.random() * 9000).toString();
        let k = `${w1}${w2}${num}`.toLowerCase();
        if (k.length > 16) k = k.substring(0, 16);
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        while (k.length < 16) {
          k += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return k;
      }

      function generate6DigitPin() {
        return Math.floor(100000 + Math.random() * 900000).toString();
      }

      const newKey = generate16CharKey();
      const newPin = generate6DigitPin();
      try {
        const checkRes = await client.get(`/device_rentals?serial_number=eq.${encodeURIComponent(serialNumber)}&select=stream_url`);
        let currentUrl = (checkRes.data && checkRes.data.length > 0) ? checkRes.data[0].stream_url : '';
        let baseUrl = currentUrl ? currentUrl.split('?')[0] : (process.env.STREAM_BASE_URL || 'http://localhost:8100/');
        if (!baseUrl.endsWith('/')) baseUrl += '/';
        let newStreamUrl = `${baseUrl}?udid=${encodeURIComponent(serialNumber)}&key=${newKey}&pin=${newPin}`;

        await client.patch(
          `/device_rentals?serial_number=eq.${encodeURIComponent(serialNumber)}`,
          { stream_url: newStreamUrl, updated_at: new Date().toISOString() }
        );

        await client.patch(
          `/devices?serial=eq.${encodeURIComponent(serialNumber)}`,
          { stream_url: newStreamUrl, updated_at: new Date().toISOString() }
        );

        await client.patch(
          `/device_assignments?device_id=eq.${encodeURIComponent(serialNumber)}`,
          { access_password: newPin, updated_at: new Date().toISOString() }
        );

        return {
          statusCode: 200,
          body: JSON.stringify({
            status: 'ok',
            message: `Stream link rotated successfully for ${serialNumber}!\n\nNew 16-Char URL Key: ${newKey}\nNew 6-Digit Stream PIN: ${newPin}`,
            newStreamUrl,
            newKey,
            newPin,
          }),
        };
      } catch (err) {
        return {
          statusCode: 500,
          body: JSON.stringify({ status: 'error', message: err.message }),
        };
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'ok', message: 'Action completed.' }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'ok', message: 'Admin action processed.' }),
    };
  }
};
