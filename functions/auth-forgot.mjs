import { sql, randomToken, json } from '../lib/auth.mjs';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL;

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const { email } = await req.json();
  const genericResponse = json({ ok: true, message: 'If that email is registered, a reset link has been sent.' });
  if (!email) return genericResponse;

  const [row] = await sql`SELECT * FROM team_user WHERE email = ${email.toLowerCase().trim()}`;
  if (!row) return genericResponse;

  const token = randomToken();
  const expires = new Date(Date.now() + 30 * 60 * 1000);
  await sql`UPDATE team_user SET reset_token = ${token}, reset_token_expires = ${expires.toISOString()} WHERE id = ${row.id}`;

  if (process.env.RESEND_API_KEY && FROM_EMAIL) {
    const origin = new URL(req.url).origin;
    const resetUrl = `${origin}/?reset=${token}`;
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: [row.email],
        subject: 'Reset your password',
        html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#111008"><p>We received a request to reset your password.</p><p><a href="${resetUrl}" style="color:#111008;font-weight:700;">Click here to set a new password</a> (link expires in 30 minutes).</p><p style="color:#6B6560;">If you didn't request this, you can ignore this email.</p></div>`,
      });
    } catch (err) {
      console.error('Failed to send reset email:', err.message);
    }
  }

  return genericResponse;
};

export const config = {
  path: '/api/auth-forgot',
};
