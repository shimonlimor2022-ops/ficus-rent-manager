import { sql, clearCookieHeader, json } from '../lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  await sql`UPDATE admin_user SET session_token = NULL WHERE id = 1`;
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookieHeader() });
};

export const config = {
  path: '/api/auth-logout',
};
