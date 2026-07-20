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
    const { email } = await req.json();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return json({ error: "Please enter a valid email address." }, 400);
    }
    const cleanEmail = email.toLowerCase().trim();
    const [existing] = await sql`SELECT id FROM team_user WHERE email = ${cleanEmail}`;
    if (existing) return json({ error: "This person is already on the team." }, 409);
    const inviteToken = randomToken();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await sql`
      INSERT INTO team_user (email, role, invite_token, invite_token_expires, invited_by)
      VALUES (${cleanEmail}, 'member', ${inviteToken}, ${expires.toISOString()}, ${user.id})
    `;
    if (process.env.RESEND_API_KEY && FROM_EMAIL) {
      const origin = new URL(req.url).origin;
      const joinUrl = `${origin}/?join=${inviteToken}`;
      try {
        await resend.emails.send({
          from: FROM_EMAIL,
          to: [cleanEmail],
          subject: "You have been invited to Ficus Investments",
          html: "<div style=\"font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#111008\"><p>" + user.email + " has invited you to join the Ficus Investments rent management team.</p><p><a href=\"" + joinUrl + "\" style=\"color:#111008;font-weight:700;\">Click here to join the team</a> (link expires in 7 days).</p></div>",
        });
      } catch (err) {
        console.error('Failed to send invite email:', err.message);
      }
    }
    return json({ ok: true }, 201);
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
