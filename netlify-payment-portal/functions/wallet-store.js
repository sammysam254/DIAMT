'use strict';

const axios = require('axios');

const memoryWallets = new Map();

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  return axios.create({
    baseURL: `${supabaseUrl.replace(/\/$/, '')}/rest/v1`,
    timeout: 5000,
    headers: {
      apikey: supabaseServiceRoleKey,
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
  });
}

async function getBalance(userId) {
  if (!userId) return 0;
  const normalizedUser = userId.toLowerCase().trim();

  const client = getSupabaseClient();

  // 1. Check user_profiles table in Supabase
  try {
    const res = await client.get(`/user_profiles?id=eq.${encodeURIComponent(normalizedUser)}&select=*`);
    if (res.data && res.data.length > 0) {
      const fn = res.data[0].full_name || '';
      if (fn.startsWith('WALLET_BAL:')) {
        const bal = parseFloat(fn.replace('WALLET_BAL:', '')) || 0;
        memoryWallets.set(normalizedUser, bal);
        return bal;
      }
    }
  } catch (_) {}

  // 2. Check user_wallets table as secondary fallback
  try {
    const res2 = await client.get(`/user_wallets?user_id=eq.${encodeURIComponent(normalizedUser)}&select=*`);
    if (res2.data && res2.data.length > 0) {
      const bal = parseFloat(res2.data[0].balance || 0);
      memoryWallets.set(normalizedUser, bal);
      return bal;
    }
  } catch (_) {}

  // 3. Fallback to memory map or default
  if (memoryWallets.has(normalizedUser)) {
    return memoryWallets.get(normalizedUser);
  }

  // Default initial seed balance for admin/owner
  const defaultBal = (normalizedUser === 'sammdev.ai@gmail.com' || normalizedUser === 'sammyseth260@gmail.com') ? 100.00 : 0.00;
  return defaultBal;
}

async function addCredit(userId, amount) {
  if (!userId) return 0;
  const normalizedUser = userId.toLowerCase().trim();
  const currentBal = await getBalance(normalizedUser);
  const newBal = currentBal + parseFloat(amount || 0);

  memoryWallets.set(normalizedUser, newBal);

  const client = getSupabaseClient();

  // Persist balance in user_profiles.full_name
  try {
    await client.post('/user_profiles', {
      id: normalizedUser,
      email: normalizedUser,
      full_name: `WALLET_BAL:${newBal.toFixed(2)}`,
      updated_at: new Date().toISOString(),
    });
  } catch (_) {}

  // Also attempt posting to user_wallets table
  try {
    await client.post('/user_wallets', {
      user_id: normalizedUser,
      balance: newBal,
      updated_at: new Date().toISOString(),
    });
  } catch (_) {}

  return newBal;
}

async function deductBalance(userId, amount) {
  if (!userId) return { success: false, balance: 0 };
  const normalizedUser = userId.toLowerCase().trim();
  const cost = parseFloat(amount || 0);
  const currentBal = await getBalance(normalizedUser);

  if (currentBal < cost) {
    return { success: false, balance: currentBal };
  }

  const newBal = currentBal - cost;
  memoryWallets.set(normalizedUser, newBal);

  const client = getSupabaseClient();

  // Persist balance in user_profiles.full_name
  try {
    await client.post('/user_profiles', {
      id: normalizedUser,
      email: normalizedUser,
      full_name: `WALLET_BAL:${newBal.toFixed(2)}`,
      updated_at: new Date().toISOString(),
    });
  } catch (_) {}

  // Also attempt posting to user_wallets table
  try {
    await client.post('/user_wallets', {
      user_id: normalizedUser,
      balance: newBal,
      updated_at: new Date().toISOString(),
    });
  } catch (_) {}

  return { success: true, balance: newBal };
}

let cctvWallAccessAllowed = true;

async function getCctvAccess() {
  const client = getSupabaseClient();
  try {
    const res = await client.get('/user_profiles?id=eq.CCTV_ACCESS_PERM&select=*');
    if (res.data && res.data.length > 0) {
      const val = res.data[0].full_name || '';
      if (val === 'CCTV_PERM:BLOCKED') return false;
      if (val === 'CCTV_PERM:ALLOWED') return true;
    }
  } catch (_) {}
  return cctvWallAccessAllowed;
}

async function setCctvAccess(allowed) {
  cctvWallAccessAllowed = !!allowed;
  const client = getSupabaseClient();
  try {
    await client.post('/user_profiles', {
      id: 'CCTV_ACCESS_PERM',
      email: 'CCTV_ACCESS_PERM',
      full_name: `CCTV_PERM:${allowed ? 'ALLOWED' : 'BLOCKED'}`,
      updated_at: new Date().toISOString(),
    });
  } catch (_) {}
  return cctvWallAccessAllowed;
}

module.exports = {
  getBalance,
  addCredit,
  deductBalance,
  getCctvAccess,
  setCctvAccess,
};
