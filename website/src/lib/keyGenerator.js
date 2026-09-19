/**
 * Key and PIN Generator for Device Stream Access
 */

// Generates a 16-character random word + number key for URL stream link
export function generate16CharKey() {
  const words = ['flex', 'pulse', 'cloud', 'agent', 'cyber', 'hyper', 'nexus', 'shield', 'matrix', 'stream', 'turbo', 'quantum', 'vector', 'blaze', 'alpha', 'delta'];
  const w1 = words[Math.floor(Math.random() * words.length)];
  const w2 = words[Math.floor(Math.random() * words.length)];
  const num = Math.floor(1000 + Math.random() * 9000).toString();
  let key = `${w1}${w2}${num}`.toLowerCase();
  if (key.length > 16) key = key.substring(0, 16);
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  while (key.length < 16) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

// Generates a clean 6-digit PIN for stream unlock & dashboard copy
export function generate6DigitPin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Constructs stream URL with 16-character key and 6-digit PIN
export function rotateUrlWithKeyAndPin(currentUrl, serial, newKey, newPin) {
  const baseUrl = currentUrl ? currentUrl.split('?')[0] : (typeof window !== 'undefined' ? `${window.location.origin}/` : 'http://localhost:8100/');
  const cleanBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${cleanBase}?udid=${encodeURIComponent(serial)}&key=${encodeURIComponent(newKey)}&pin=${encodeURIComponent(newPin)}`;
}
