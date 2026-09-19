'use strict';

const crypto = require('crypto');

// Secret salt derived from system hardware signature / application secret
const APP_SECRET_SALT = 'DEVICEFARM_AGENT_SYSTEM_RENTAL_SECRET_2026_SALT';

function getDerivedKey() {
  return crypto.pbkdf2Sync(APP_SECRET_SALT, 'SALT_PERMANENT_KEY', 10000, 32, 'sha256');
}

/**
 * Encrypt a plain string into hex format using AES-256-CBC.
 */
function encrypt(text) {
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', getDerivedKey(), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch (err) {
    return null;
  }
}

/**
 * Decrypt a hex formatted string using AES-256-CBC.
 */
function decrypt(encryptedText) {
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 2) return null;
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', getDerivedKey(), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    return null;
  }
}

// Production Credentials Payload (Configured via config.json or Environment Variables)
const SECURE_PAYLOAD = {
  encryptedSupabaseUrl: encrypt(process.env.SUPABASE_URL || ''),
  encryptedSupabaseAnonKey: encrypt(process.env.SUPABASE_ANON_KEY || ''),
  encryptedSupabaseServiceRoleKey: encrypt(process.env.SUPABASE_SERVICE_ROLE_KEY || ''),
  encryptedAppUrl: encrypt(process.env.APP_URL || ''),
  encryptedPaystackPublicKey: encrypt(process.env.PAYSTACK_PUBLIC_KEY || ''),
  encryptedNowPaymentsKey: encrypt(process.env.NOWPAYMENTS_API_KEY || ''),
  encryptedAdminEmail: encrypt(process.env.ADMIN_EMAIL || ''),
};

/**
 * Decrypt and retrieve system security credentials safely at runtime.
 */
function getDecryptedSystemCredentials() {
  return {
    supabaseUrl: decrypt(SECURE_PAYLOAD.encryptedSupabaseUrl) || process.env.SUPABASE_URL || '',
    supabaseAnonKey: decrypt(SECURE_PAYLOAD.encryptedSupabaseAnonKey) || process.env.SUPABASE_ANON_KEY || '',
    supabaseServiceRoleKey: decrypt(SECURE_PAYLOAD.encryptedSupabaseServiceRoleKey) || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    appUrl: decrypt(SECURE_PAYLOAD.encryptedAppUrl) || process.env.APP_URL || '',
    paystackPublicKey: decrypt(SECURE_PAYLOAD.encryptedPaystackPublicKey) || process.env.PAYSTACK_PUBLIC_KEY || '',
    nowPaymentsApiKey: decrypt(SECURE_PAYLOAD.encryptedNowPaymentsKey) || process.env.NOWPAYMENTS_API_KEY || '',
    adminEmail: decrypt(SECURE_PAYLOAD.encryptedAdminEmail) || process.env.ADMIN_EMAIL || '',
  };
}

module.exports = {
  encrypt,
  decrypt,
  getDecryptedSystemCredentials,
};

