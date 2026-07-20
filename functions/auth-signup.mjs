import { sql, hashPassword, randomToken, sessionCookieHeader, passwordIssues, json } from '../lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const [existing] = await sql`SELECT id FROM team_user LIMIT 1`;
  if (existing) return json({ error: 'An account already exists. Please log in instead.' }, 409);

  const { email, password } = await req.json();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Please enter a valid email address.' }, 400);
  const issues = passwordIssues(password);
  if (issues.length) return json({ error: 'Password must include ' + issues.join(', ') + '.' }, 400);

  const { hash, salt } = await hashPassword(password);
  const token = randomToken();

  await sql`
    INSERT INTO team_user (email, password_hash, password_salt, role, session_token)
    VALUES (${email.toLowerCase().trim()}, ${hash}, ${salt}, 'owner', ${token})
  `;

  return json({ ok: true }, 201, { 'Set-Cookie': sessionCookieHeader(token) });
};

export const config = {
  path: '/api/auth-signup',
};
