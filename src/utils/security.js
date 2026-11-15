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

// Production Credentials Payload (Strictly DIAMT Cloud Platform)
const SECURE_PAYLOAD = {
  encryptedSupabaseUrl: encrypt(process.env.SUPABASE_URL || 'https://xbolsgcntkfzzpqnulsa.supabase.co'),
  encryptedSupabaseAnonKey: encrypt(process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhib2xzZ2NudGtmenpwcW51bHNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3OTU2NTAsImV4cCI6MjEwNTM3MTY1MH0.u18WPrgklzJM2kCk4-OxGKoecSuUx4BuOitHrXQNUIk'),
  encryptedSupabaseServiceRoleKey: encrypt(process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhib2xzZ2NudGtmenpwcW51bHNhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTc5NTY1MCwiZXhwIjoyMTA1MzcxNjUwfQ.ok_mAqsFkfvP-NyZRiiPmF_eL2blTYI2shnsDAmkefw'),
  encryptedAppUrl: encrypt(process.env.APP_URL || 'https://diamt.netlify.app'),
  encryptedPaystackPublicKey: encrypt(process.env.PAYSTACK_PUBLIC_KEY || ''),
  encryptedNowPaymentsKey: encrypt(process.env.NOWPAYMENTS_API_KEY || ''),
  encryptedAdminEmail: encrypt(process.env.ADMIN_EMAIL || 'sammyseth260@gmail.com'),
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

