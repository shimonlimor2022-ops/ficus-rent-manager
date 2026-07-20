import { sql, getCookie, clearCookieHeader, json } from '../lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const token = getCookie(req, 'session');
  if (token) {
    await sql`UPDATE team_user SET session_token = NULL WHERE session_token = ${token}`;
  }

  return json({ ok: true }, 200, { 'Set-Cookie': clearCookieHeader() });
};

export const config = {
  path: '/api/auth-logout',
};
