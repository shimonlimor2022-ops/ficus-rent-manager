import { sql, getSessionUser, hashPassword, randomToken, sessionCookieHeader, passwordIssues, json } from '../lib/auth.mjs';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL;

export default async (req) => {
  if (req.method === 'PUT') {
    const { token, password } = await req.json();
    if (!token) return json({ error: "Missing invite token." }, 400);
    const issues = passwordIssues(password);
    if (issues.length) return json({ error: "Password must include " + issues.join(', ') + "." }, 400);
    const [row] = await sql`SELECT * FROM team_user WHERE invite_token = ${token}`;
    if (!row) return json({ error: "This invite link is invalid." }, 400);
    if (!row.invite_token_expires || new Date(row.invite_token_expires) < new Date()) {
      return json({ error: "This invite link has expired. Ask the owner to resend it." }, 400);
    }
    const { hash, salt } = await hashPassword(password);
    const sessionToken = randomToken();
    await sql`
      UPDATE team_user SET
        password_hash = ${hash},
        password_salt = ${salt},
        invite_token = NULL,
        invite_token_expires = NULL,
        session_token = ${sessionToken},
        last_login = now()
      WHERE id = ${row.id}
    `;
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookieHeader(sessionToken) });
  }

  const user = await getSessionUser(req);
  if (!user) return json({ error: "Not signed in." }, 401);

  if (req.method === 'GET') {
    const members = await sql`SELECT email, role, last_login FROM team_user ORDER BY created_at ASC`;
    return json({ members, isOwner: user.role === 'owner', selfEmail: user.email });
  }

  if (req.method === 'POST') {
    if (user.role !== 'owner') return json({ error: "Only the owner can add team members." }, 403);
    const { email, role } = await req.json();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return json({ error: "Please enter a valid email address." }, 400);
    }
    const cleanRole = role === 'owner' ? 'owner' : 'member';
    const cleanEmail = email.toLowerCase().trim();
    const [existing] = await sql`SELECT id FROM team_user WHERE email = ${cleanEmail}`;
    if (existing) return json({ error: "This person is already on the team." }, 409);
    const inviteToken = randomToken();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await sql`
      INSERT INTO team_user (email, role, invite_token, invite_token_expires, invited_by)
      VALUES (${cleanEmail}, ${cleanRole}, ${inviteToken}, ${expires.toISOString()}, ${user.id})
    `;
    if (process.env.RESEND_API_KEY && FROM_EMAIL) {
      const origin = new URL(req.url).origin;
      const joinUrl = origin + "/?join=" + inviteToken;
      try {
        await resend.emails.send({
          from: FROM_EMAIL,
          to: [cleanEmail],
          subject: "Ficus Investments - team access setup",
          html: "<div style=\"font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#111008;max-width:480px\">" +
            "<p>Hello,</p>" +
            "<p>" + user.email + " has invited you to join the Ficus Investments rent management team. This system is used to track rental properties, payment dates, and lease information for Ficus Investments.</p>" +
            "<p style=\"margin:24px 0;\"><a href=\"" + joinUrl + "\" style=\"background:#111008;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block;\">Accept invitation</a></p>" +
            "<p style=\"color:#555;font-size:13px;\">This invitation link expires in 7 days. If you were not expecting this invitation, you can safely ignore this email.</p>" +
            "<p style=\"color:#999;font-size:12px;margin-top:32px;border-top:1px solid #eee;padding-top:12px;\">Ficus Investments &middot; Rent Management System</p>" +
            "</div>",
        });
      } catch (err) {
        console.error('Failed to send invite email:', err.message);
      }
    }
    return json({ ok: true }, 201);
  }

  if (req.method === 'PATCH') {
    if (user.role !== 'owner') return json({ error: "Only the owner can change roles." }, 403);
    const { email, role } = await req.json();
    if (!email || role !== 'owner') return json({ error: "Invalid request." }, 400);
    const cleanEmail = email.toLowerCase().trim();
    if (cleanEmail === user.email) return json({ error: "You are already the owner." }, 400);
    const [target] = await sql`SELECT * FROM team_user WHERE email = ${cleanEmail}`;
    if (!target) return json({ error: "That person is not on the team." }, 404);
    if (target.role === 'owner') return json({ error: "That person is already an owner." }, 400);
    await sql`UPDATE team_user SET role = 'owner' WHERE email = ${cleanEmail}`;
    return json({ ok: true });
  }

  if (req.method === 'DELETE') {
    if (user.role !== 'owner') return json({ error: "Only the owner can remove team members." }, 403);
    const { email } = await req.json();
    if (!email) return json({ error: "Missing email." }, 400);
    const cleanEmail = email.toLowerCase().trim();
    if (cleanEmail === user.email) {
      return json({ error: "You cannot remove yourself. Ask another owner to do it." }, 400);
    }
    const [target] = await sql`SELECT * FROM team_user WHERE email = ${cleanEmail}`;
    if (!target) return json({ error: "That person is not on the team." }, 404);
    await sql`DELETE FROM team_user WHERE email = ${cleanEmail}`;
    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = {
  path: '/api/team',
};
