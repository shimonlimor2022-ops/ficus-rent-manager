import { neon } from '@netlify/neon';
import { isAuthenticated, getSessionUser, json } from '../lib/auth.mjs';
const sql = neon();

let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`ALTER TABLE properties ADD COLUMN IF NOT EXISTS track_lease BOOLEAN DEFAULT true`;
      await sql`
        CREATE TABLE IF NOT EXISTS lease_periods (
          id SERIAL PRIMARY KEY,
          property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
          expiry_date DATE NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          new_expiry_date DATE,
          note TEXT,
          resolved_at TIMESTAMP,
          resolved_by TEXT,
          created_at TIMESTAMP DEFAULT now(),
          UNIQUE(property_id, expiry_date)
        )
      `;
    })().catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

// Every tracked, non-auto-renewing lease whose expiry date has passed becomes an open item.
async function createDueLeases() {
  await sql`
    INSERT INTO lease_periods (property_id, expiry_date, status)
    SELECT id, lease_expiry_date, 'open'
    FROM properties
    WHERE track_lease = true
      AND lease_auto_renew = false
      AND lease_expiry_date IS NOT NULL
      AND lease_expiry_date <= CURRENT_DATE
    ON CONFLICT (property_id, expiry_date) DO NOTHING
  `;
}


export default async (req) => {
  if (!(await isAuthenticated(req))) return json({ error: 'unauthorized' }, 401);
  try {
    await ensureSchema();
    const user = await getSessionUser(req);
    const who = user ? user.email : null;
    const url = new URL(req.url);

    if (req.method === 'GET') {
      await createDueLeases();
      const view = url.searchParams.get('view') || 'open';

      if (view === 'open') {
        const rows = await sql`
          SELECT l.id, l.property_id, to_char(l.expiry_date, 'YYYY-MM-DD') AS expiry_date,
                 l.status, to_char(l.new_expiry_date, 'YYYY-MM-DD') AS new_expiry_date,
                 pr.property_name, pr.contact_name
          FROM lease_periods l
          JOIN properties pr ON pr.id = l.property_id
          WHERE l.status = 'open' AND pr.track_lease = true
          ORDER BY l.expiry_date ASC
        `;
        return json(rows);
      }

      if (view === 'latest') {
        const rows = await sql`
          SELECT DISTINCT ON (l.property_id)
                 l.property_id, to_char(l.expiry_date, 'YYYY-MM-DD') AS expiry_date, l.status
          FROM lease_periods l
          ORDER BY l.property_id, l.expiry_date DESC
        `;
        return json(rows);
      }

      const pidRaw = url.searchParams.get('property_id');
      const pid = pidRaw ? parseInt(pidRaw, 10) : null;
      const rows = await sql`
        SELECT l.id, l.property_id, to_char(l.expiry_date, 'YYYY-MM-DD') AS expiry_date,
               l.status, to_char(l.new_expiry_date, 'YYYY-MM-DD') AS new_expiry_date,
               to_char(l.resolved_at, 'YYYY-MM-DD') AS resolved_at,
               pr.property_name, pr.contact_name
        FROM lease_periods l
        JOIN properties pr ON pr.id = l.property_id
        WHERE (${pid}::int IS NULL OR l.property_id = ${pid}::int)
        ORDER BY l.expiry_date DESC, pr.property_name ASC
      `;
      return json(rows);
    }

    if (req.method === 'POST') {
      const b = await req.json();
      if (b.action !== 'set_status') return json({ error: 'unknown action' }, 400);
      if (!b.period_id) return json({ error: 'missing period_id' }, 400);
      const [p] = await sql`SELECT * FROM lease_periods WHERE id = ${b.period_id}`;
      if (!p) return json({ error: 'period not found' }, 404);

      if (b.status === 'renewed') {
        if (!b.new_expiry_date) return json({ error: 'Please choose the new expiry date.' }, 400);
        const [chk] = await sql`SELECT (${b.new_expiry_date}::date > expiry_date) AS ok FROM lease_periods WHERE id = ${p.id}`;
        if (!chk.ok) return json({ error: 'The new expiry date must be after the old one.' }, 400);
        await sql`
          UPDATE lease_periods
          SET status = 'renewed', new_expiry_date = ${b.new_expiry_date},
              resolved_at = now(), resolved_by = ${who}
          WHERE id = ${p.id}
        `;
        await sql`
          UPDATE properties
          SET lease_expiry_date = ${b.new_expiry_date},
              alert_3mo_sent = false, alert_1wk_sent = false
          WHERE id = ${p.property_id}
        `;
        return json({ ok: true });
      }

      if (b.status === 'not_renewed') {
        await sql`
          UPDATE lease_periods
          SET status = 'not_renewed', new_expiry_date = NULL,
              resolved_at = now(), resolved_by = ${who}
          WHERE id = ${p.id}
        `;
        return json({ ok: true });
      }

      if (b.status === 'open') {
        if (p.status === 'renewed') {
          return json({ error: 'A renewed lease cannot be reopened.' }, 400);
        }
        await sql`
          UPDATE lease_periods
          SET status = 'open', resolved_at = NULL, resolved_by = NULL
          WHERE id = ${p.id}
        `;
        return json({ ok: true });
      }

      return json({ error: 'invalid status' }, 400);
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (err) {
    console.error(err);
    return json({ error: err.message }, 500);
  }
};

export const config = {
  path: '/api/leases',
};
