import { sql, hashPassword, randomToken, sessionCookieHeader, json } from '../lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const { email, password } = await req.json();
  if (!email || !password) return json({ error: 'Email and password are required.' }, 400);

  const [row] = await sql`SELECT * FROM team_user WHERE email = ${email.toLowerCase().trim()}`;
  if (!row || !row.password_hash) {
    return json({ error: 'Incorrect email or password.' }, 401);
  }

  const { hash } = await hashPassword(password, row.password_salt);
  if (hash !== row.password_hash) {
    return json({ error: 'Incorrect email or password.' }, 401);
  }

  const token = randomToken();
  await sql`UPDATE team_user SET session_token = ${token} WHERE id = ${row.id}`;

  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookieHeader(token) });
};

export const config = {
  path: '/api/auth-login',
};
