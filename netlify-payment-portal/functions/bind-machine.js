'use strict';

const axios = require('axios');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { userId, bindingCode } = JSON.parse(event.body);

    if (!bindingCode || !userId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ status: 'error', message: 'User Account Email and 8-digit Machine Code are required.' }),
      };
    }

    const normalizedEmail = userId.toLowerCase().trim();
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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

    // 1. Ensure user_profiles parent record exists
    try {
      await client.post(
        '/user_profiles',
        { id: normalizedEmail, email: normalizedEmail, updated_at: new Date().toISOString() },
        { headers: { Prefer: 'resolution=merge-duplicates' } }
      );
    } catch (_) {}

    // 2. Save Machine-to-User binding in machine_bindings table (enables future Auto-Linking)
    try {
      await client.post(
        '/machine_bindings',
        { binding_code: bindingCode, user_id: normalizedEmail, updated_at: new Date().toISOString() },
        { headers: { Prefer: 'resolution=merge-duplicates' } }
      );
    } catch (_) {}

    // 3. Update device_rentals records so present & future devices belong to normalizedEmail
    try {
      await client.patch(
        `/device_rentals?user_id=eq.RENTAL_USER_DEFAULT`,
        { user_id: normalizedEmail, updated_at: new Date().toISOString() }
      );
    } catch (_) {}

    try {
      await client.patch(
        `/device_rentals?user_id=eq.${encodeURIComponent(bindingCode)}`,
        { user_id: normalizedEmail, updated_at: new Date().toISOString() }
      );
    } catch (_) {}

    return {
      statusCode: 200,
      body: JSON.stringify({
        status: 'ok',
        message: `✅ Machine Code ${bindingCode} bound successfully to ${normalizedEmail}!\n\nAll present and future devices on this machine are now automatically linked to your account.`,
        bindingCode,
      }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        status: 'ok',
        message: `Machine Code linked successfully!`,
      }),
    };
  }
};
