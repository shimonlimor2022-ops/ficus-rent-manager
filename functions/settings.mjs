import { neon } from '@netlify/neon';
import { isAuthenticated, json as authJson } from '../lib/auth.mjs';

const sql = neon();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async (req) => {
  if (!(await isAuthenticated(req))) return authJson({ error: 'unauthorized' }, 401);

  try {
    if (req.method === 'GET') {
      const [row] = await sql`SELECT notification_emails FROM settings WHERE id = 1`;
      return json({ notification_emails: row?.notification_emails || [] });
    }

    if (req.method === 'PUT') {
      const b = await req.json();
      const emails = Array.isArray(b.notification_emails)
        ? b.notification_emails.filter(Boolean).map((e) => String(e).trim())
        : [];
      const [row] = await sql`
        UPDATE settings SET notification_emails = ${emails}
        WHERE id = 1
        RETURNING notification_emails
      `;
      return json({ notification_emails: row.notification_emails });
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (err) {
    console.error(err);
    return json({ error: err.message }, 500);
  }
};

export const config = {
  path: '/api/settings',
};
