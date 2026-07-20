import { sql, getSessionUser, hashPassword, randomToken, sessionCookieHeader, passwordIssues, json } from '../lib/auth.mjs';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL;

export default async (req) => {
  if (req.method === 'PUT') {
    const { token, password } = await req.json();
    if (!token) return json({ error: 'Missing invite token.' }, 400);
    const issues = passwordIssues(password);
    if (issues.length) return json({ error: 'Password must include ' + issues.join(', ') + '.' }, 400);
    const [row] = await sql`SELECT * FROM team_user WHERE invite_token = ${token}`;
    if (!row) return json({ error: 'This invite link is invalid.' }, 400);
    if (!row.invite_token_expires || new Date(row.invite_token_expires) < new Date()) {
      return json({ error: 'This invite link has expired. Ask the
