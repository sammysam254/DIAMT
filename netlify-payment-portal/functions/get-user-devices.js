'use strict';

const axios = require('axios');

exports.handler = async (event) => {
  const bindingCode = event.queryStringParameters ? event.queryStringParameters.bindingCode : null;
  const rawUserId = event.queryStringParameters ? event.queryStringParameters.userId : null;
  const userId = rawUserId ? rawUserId.toLowerCase().trim() : null;

  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  try {
    const client = axios.create({
      baseURL: `${supabaseUrl.replace(/\/$/, '')}/rest/v1`,
      timeout: 6000,
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        'Content-Type': 'application/json',
      },
    });

    let devices = [];
    const seenSerials = new Set();

    // 1. Fetch devices matching user_id = normalized email
    if (userId) {
      try {
        const resUser = await client.get(`/device_rentals?user_id=eq.${encodeURIComponent(userId)}&select=*`);
        if (resUser.data && Array.isArray(resUser.data)) {
          resUser.data.forEach(d => {
            if (!seenSerials.has(d.serial_number)) {
              seenSerials.add(d.serial_number);
              devices.push(d);
            }
          });
        }
      } catch (_) {}
    }

    // 2. Fetch default devices matching RENTAL_USER_DEFAULT
    try {
      const resDefault = await client.get('/device_rentals?user_id=eq.RENTAL_USER_DEFAULT&select=*');
      if (resDefault.data && Array.isArray(resDefault.data)) {
        resDefault.data.forEach(d => {
          if (!seenSerials.has(d.serial_number)) {
            seenSerials.add(d.serial_number);
            devices.push(d);
          }
        });
      }
    } catch (_) {}

    // 3. Query by bindingCode if provided
    if (bindingCode) {
      try {
        const resCode = await client.get(`/device_rentals?user_id=eq.${encodeURIComponent(bindingCode)}&select=*`);
        if (resCode.data && Array.isArray(resCode.data)) {
          resCode.data.forEach(d => {
            const s = d.serial_number || d.serial;
            if (s && !seenSerials.has(s)) {
              seenSerials.add(s);
              devices.push(d);
            }
          });
        }
      } catch (_) {}

      try {
        const resBindingCol = await client.get(`/device_rentals?binding_code=eq.${encodeURIComponent(bindingCode)}&select=*`);
        if (resBindingCol.data && Array.isArray(resBindingCol.data)) {
          resBindingCol.data.forEach(d => {
            const s = d.serial_number || d.serial;
            if (s && !seenSerials.has(s)) {
              seenSerials.add(s);
              devices.push(d);
            }
          });
        }
      } catch (_) {}

      try {
        const resDev = await client.get(`/devices?binding_code=eq.${encodeURIComponent(bindingCode)}&select=*`);
        if (resDev.data && Array.isArray(resDev.data)) {
          resDev.data.forEach(d => {
            const s = d.serial || d.serial_number;
            if (s && !seenSerials.has(s)) {
              seenSerials.add(s);
              devices.push({
                serial_number: s,
                device_model: d.model || 'Android Device',
                device_brand: d.brand || 'Generic',
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
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'ok', devices }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      body: JSON.stringify({ status: 'ok', devices: [] }),
    };
  }
};
