import { neon } from '@netlify/neon';

export const sql = neon();

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

export async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const salt = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt) };
}

export function randomToken() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function getCookie(req, name) {
  const header = req.headers.get('cookie') || '';
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}

export function sessionCookieHeader(token, maxAgeSeconds = 60 * 60 * 24 * 30) {
  return `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearCookieHeader() {
  return `session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// Returns true if the request has a valid session matching the stored admin session_token.
export async function isAuthenticated(req) {
  const token = getCookie(req, 'session');
  if (!token) return false;
  const [row] = await sql`SELECT session_token FROM admin_user WHERE id = 1`;
  return !!row && row.session_token === token;
}

export function passwordIssues(password) {
  const issues = [];
  if (!password || password.length < 10) issues.push('at least 10 characters');
  if (!/[a-z]/.test(password || '')) issues.push('a lowercase letter');
  if (!/[A-Z]/.test(password || '')) issues.push('an uppercase letter');
  if (!/[0-9]/.test(password || '')) issues.push('a number');
  if (!/[^a-zA-Z0-9]/.test(password || '')) issues.push('a symbol');
  return issues;
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}
