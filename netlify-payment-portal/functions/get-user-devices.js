'use strict';

const axios = require('axios');

exports.handler = async (event) => {
  const bindingCode = event.queryStringParameters ? event.queryStringParameters.bindingCode : null;
  const rawUserId = event.queryStringParameters ? event.queryStringParameters.userId : null;
  const userId = rawUserId ? rawUserId.toLowerCase().trim() : null;

  const supabaseUrl = process.env.SUPABASE_URL || 'https://xbolsgcntkfzzpqnulsa.supabase.co';
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

  try {
    const client = axios.create({
      baseURL: `${supabaseUrl.replace(/\/$/, '')}/rest/v1`,
      timeout: 8000,
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        'Content-Type': 'application/json',
      },
    });

    let devices = [];
    const seenSerials = new Set();

    // 1. Fetch from public.devices table (Autonomous agent sync)
    try {
      const resDev = await client.get('/devices?select=*&order=updated_at.desc');
      if (resDev.data && Array.isArray(resDev.data)) {
        resDev.data.forEach(d => {
          const s = d.serial || d.serial_number;
          if (s && !seenSerials.has(s)) {
            seenSerials.add(s);
            devices.push({
              serial_number: s,
              device_model: d.model || d.device_model || 'Android Device',
              device_brand: d.brand || d.device_brand || 'Hardware Node',
              status: 'active',
              is_paid: true,
              binding_code: d.binding_code || 'AUTONOMOUS',
              stream_url: d.stream_url || `http://localhost:${d.local_port || 8100}`,
              local_port: d.local_port || 8100,
              updated_at: d.updated_at || new Date().toISOString(),
              stealth_root_enabled: d.stealth_root_enabled !== false,
            });
          }
        });
      }
    } catch (_) {}

    // 2. Fetch from device_rentals table if present
    try {
      const resRent = await client.get('/device_rentals?select=*&order=updated_at.desc');
      if (resRent.data && Array.isArray(resRent.data)) {
        resRent.data.forEach(d => {
          const s = d.serial_number || d.serial;
          if (s && !seenSerials.has(s)) {
            seenSerials.add(s);
            devices.push({
              serial_number: s,
              device_model: d.device_model || 'Android Device',
              device_brand: d.device_brand || 'Hardware Node',
              status: 'active',
              is_paid: true,
              binding_code: d.binding_code || 'AUTONOMOUS',
              stream_url: d.stream_url || `http://localhost:${d.local_port || 8100}`,
              local_port: d.local_port || 8100,
              updated_at: d.updated_at || new Date().toISOString(),
              stealth_root_enabled: d.stealth_root_enabled !== false,
            });
          }
        });
      }
    } catch (_) {}

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ok', devices }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ok', devices: [] }),
    };
  }
};
