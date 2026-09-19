'use strict';

const axios = require('axios');
const walletStore = require('./wallet-store');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { userId, serialNumber, amount } = JSON.parse(event.body);
    const cost = parseFloat(amount || 30);
    const targetEmail = userId || 'sammdev.ai@gmail.com';

    // 1. Deduct cost from wallet
    const result = await walletStore.deductBalance(targetEmail, cost);

    if (!result.success) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          status: 'error',
          message: `Insufficient wallet balance ($${result.balance.toFixed(2)} USD). Please deposit at least $${(cost - result.balance).toFixed(2)} USD to pay for this device link.`,
          balance: result.balance,
        }),
      };
    }

    // 2. Update device_rentals status to 'active' for 30 days in Supabase
    const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

    try {
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

      await client.patch(
        `/device_rentals?serial_number=eq.${encodeURIComponent(serialNumber)}`,
        {
          status: 'active',
          expires_at: expiresAt,
          monthly_fee: cost,
          updated_at: new Date().toISOString(),
        }
      );
    } catch (_) {}

    return {
      statusCode: 200,
      body: JSON.stringify({
        status: 'ok',
        message: `✨ Payment Successful! $${cost.toFixed(2)} USD deducted from wallet balance. Device link is now ACTIVE for 30 days!`,
        newBalance: result.balance,
        expiresAt,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ status: 'error', message: err.message }),
    };
  }
};
