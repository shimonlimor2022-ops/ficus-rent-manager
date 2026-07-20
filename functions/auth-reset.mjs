import { sql, hashPassword, randomToken, sessionCookieHeader, passwordIssues, json } from '../lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const { token, password } = await req.json();
  if (!token) return json({ error: 'Missing reset token.' }, 400);

  const issues = passwordIssues(password);
  if (issues.length) return json({ error: 'Password must include ' + issues.join(', ') + '.' }, 400);

  const [row] = await sql`SELECT * FROM admin_user WHERE id = 1`;
  if (!row || row.reset_token !== token) return json({ error: 'This reset link is invalid.' }, 400);
  if (!row.reset_token_expires || new Date(row.reset_token_expires) < new Date()) {
    return json({ error: 'This reset link has expired. Please request a new one.' }, 400);
  }

  const { hash, salt } = await hashPassword(password);
  const sessionToken = randomToken();

  await sql`
    UPDATE admin_user SET
      password_hash = ${hash},
      password_salt = ${salt},
      reset_token = NULL,
      reset_token_expires = NULL,
      session_token = ${sessionToken}
    WHERE id = 1
  `;

  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookieHeader(sessionToken) });
};

export const config = {
  path: '/api/auth-reset',
};
