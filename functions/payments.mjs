import { neon } from '@netlify/neon';
import { isAuthenticated, getSessionUser, json } from '../lib/auth.mjs';
const sql = neon();

async function recompute(periodId) {
  const [p] = await sql`SELECT * FROM rent_periods WHERE id = ${periodId}`;
  if (!p) return;
  const [s] = await sql`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM rent_payment_entries WHERE period_id = ${periodId}
  `;
  const total = Number(s.total);
  const expected = p.expected_amount === null ? null : Number(p.expected_amount);
  let status = 'open';
  if (total > 0) {
    status = expected !== null && total >= expected ? 'paid' : 'partial';
  }
  if (status === 'paid') {
    await sql`UPDATE rent_periods SET status = 'paid', resolved_at = now() WHERE id = ${periodId}`;
  } else {
    await sql`UPDATE rent_periods SET status = ${status}, resolved_at = NULL WHERE id = ${periodId}`;
  }
}

export default async (req) => {
  if (!(await isAuthenticated(req))) return json({ error: 'unauthorized' }, 401);
  try {
    const user = await getSessionUser(req);
    const who = user ? user.email : null;
    const url = new URL(req.url);

    if (req.method === 'GET') {
      const view = url.searchParams.get('view') || 'history';

      if (view === 'open') {
        const rows = await sql`
          SELECT p.id, p.property_id, to_char(p.due_date, 'YYYY-MM-DD') AS due_date,
                 p.expected_amount, p.status,
                 pr.property_name, pr.contact_name,
                 COALESCE(SUM(e.amount), 0) AS paid_total,
                 COALESCE(
                   json_agg(json_build_object(
                     'id', e.id,
                     'paid_date', to_char(e.paid_date, 'YYYY-MM-DD'),
                     'amount', e.amount,
                     'note', e.note
                   ) ORDER BY e.paid_date, e.id) FILTER (WHERE e.id IS NOT NULL),
                   '[]'::json
                 ) AS entries
          FROM rent_periods p
          JOIN properties pr ON pr.id = p.property_id
          LEFT JOIN rent_payment_entries e ON e.period_id = p.id
          WHERE p.status IN ('open', 'partial') AND pr.track_payments = true
          GROUP BY p.id, pr.id
          ORDER BY p.due_date ASC
        `;
        return json(rows);
      }

      const pidRaw = url.searchParams.get('property_id');
      const pid = pidRaw ? parseInt(pidRaw, 10) : null;
      const tenant = (url.searchParams.get('tenant') || '').trim() || null;
      const monthRaw = url.searchParams.get('month');
      const month = monthRaw ? parseInt(monthRaw, 10) : null;
      const yearRaw = url.searchParams.get('year');
      const year = yearRaw ? parseInt(yearRaw, 10) : null;
      const tenantLike = tenant ? '%' + tenant + '%' : null;

      const rows = await sql`
        SELECT p.id, p.property_id, to_char(p.due_date, 'YYYY-MM-DD') AS due_date,
               p.expected_amount, p.status,
               pr.property_name, pr.contact_name,
               COALESCE(SUM(e.amount), 0) AS paid_total,
               COALESCE(
                 json_agg(json_build_object(
                   'id', e.id,
                   'paid_date', to_char(e.paid_date, 'YYYY-MM-DD'),
                   'amount', e.amount,
                   'note', e.note
                 ) ORDER BY e.paid_date, e.id) FILTER (WHERE e.id IS NOT NULL),
                 '[]'::json
               ) AS entries
        FROM rent_periods p
        JOIN properties pr ON pr.id = p.property_id
        LEFT JOIN rent_payment_entries e ON e.period_id = p.id
        WHERE (${pid}::int IS NULL OR p.property_id = ${pid}::int)
          AND (${tenantLike}::text IS NULL OR pr.contact_name ILIKE ${tenantLike}::text)
          AND (${month}::int IS NULL OR EXTRACT(MONTH FROM p.due_date) = ${month}::int)
          AND (${year}::int IS NULL OR EXTRACT(YEAR FROM p.due_date) = ${year}::int)
        GROUP BY p.id, pr.id
        ORDER BY p.due_date DESC, pr.property_name ASC
      `;
      return json(rows);
    }

    if (req.method === 'POST') {
      const b = await req.json();
      const action = b.action;

      if (action === 'create_period') {
        if (!b.property_id) return json({ error: 'missing property_id' }, 400);
        if (!b.due_date) return json({ error: 'missing due_date' }, 400);
        const status = ['paid', 'partial', 'unpaid'].includes(b.status) ? b.status : 'partial';
        const amount = Number(b.amount);
        if (status !== 'unpaid') {
          if (!b.paid_date) return json({ error: 'missing paid_date' }, 400);
          if (!(amount > 0)) return json({ error: 'amount must be greater than 0' }, 400);
        }
        const expected = b.expected_amount === null || b.expected_amount === undefined || b.expected_amount === ''
          ? null : Number(b.expected_amount);
        const [prop] = await sql`SELECT id FROM properties WHERE id = ${b.property_id}`;
        if (!prop) return json({ error: 'property not found' }, 404);
        const inserted = await sql`
          INSERT INTO rent_periods (property_id, due_date, expected_amount, status)
          VALUES (${b.property_id}, ${b.due_date}, ${expected}, 'open')
          ON CONFLICT (property_id, due_date) DO NOTHING
          RETURNING id
        `;
        if (inserted.length === 0) {
          return json({ error: 'A payment for this due date already exists for this property.' }, 409);
        }
        const periodId = inserted[0].id;
        if (status === 'unpaid') {
          await sql`
            UPDATE rent_periods
            SET status = 'unpaid', resolved_at = now(), resolved_by = ${who}
            WHERE id = ${periodId}
          `;
          return json({ ok: true });
        }
        await sql`
          INSERT INTO rent_payment_entries (period_id, property_id, paid_date, amount, note, created_by)
          VALUES (${periodId}, ${b.property_id}, ${b.paid_date}, ${amount}, 'Added manually', ${who})
        `;
        await recompute(periodId);
        if (status === 'paid') {
          await sql`
            UPDATE rent_periods
            SET status = 'paid', resolved_at = now(), resolved_by = ${who}
            WHERE id = ${periodId}
          `;
        }
        return json({ ok: true });
      }

      if (action === 'add_entry') {
        const amount = Number(b.amount);
        if (!b.period_id) return json({ error: 'missing period_id' }, 400);
        if (!b.paid_date) return json({ error: 'missing paid_date' }, 400);
        if (!(amount > 0)) return json({ error: 'amount must be greater than 0' }, 400);
        const [p] = await sql`SELECT * FROM rent_periods WHERE id = ${b.period_id}`;
        if (!p) return json({ error: 'period not found' }, 404);
        await sql`
          INSERT INTO rent_payment_entries (period_id, property_id, paid_date, amount, note, created_by)
          VALUES (${p.id}, ${p.property_id}, ${b.paid_date}, ${amount}, ${b.note || null}, ${who})
        `;
        await recompute(p.id);
        return json({ ok: true });
      }

      if (action === 'delete_entry') {
        if (!b.entry_id) return json({ error: 'missing entry_id' }, 400);
        const [e] = await sql`DELETE FROM rent_payment_entries WHERE id = ${b.entry_id} RETURNING period_id`;
        if (e) await recompute(e.period_id);
        return json({ ok: true });
      }

      if (action === 'set_status') {
        if (!b.period_id) return json({ error: 'missing period_id' }, 400);
        const [p] = await sql`SELECT * FROM rent_periods WHERE id = ${b.period_id}`;
        if (!p) return json({ error: 'period not found' }, 404);

        if (b.status === 'paid') {
          const [s] = await sql`
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM rent_payment_entries WHERE period_id = ${p.id}
          `;
          const total = Number(s.total);
          const expected = p.expected_amount === null ? null : Number(p.expected_amount);
          if (expected === null && total === 0) {
            return json({ error: 'no expected amount - add a payment entry instead' }, 400);
          }
          if (expected !== null && expected - total > 0) {
            const paidDate = b.paid_date || new Date().toISOString().slice(0, 10);
            await sql`
              INSERT INTO rent_payment_entries (period_id, property_id, paid_date, amount, note, created_by)
              VALUES (${p.id}, ${p.property_id}, ${paidDate}, ${expected - total}, 'Marked fully paid', ${who})
            `;
          }
          await sql`
            UPDATE rent_periods
            SET status = 'paid', resolved_at = now(), resolved_by = ${who}
            WHERE id = ${p.id}
          `;
          return json({ ok: true });
        }

        if (b.status === 'unpaid') {
          await sql`
            UPDATE rent_periods
            SET status = 'unpaid', resolved_at = now(), resolved_by = ${who}
            WHERE id = ${p.id}
          `;
          return json({ ok: true });
        }

        if (b.status === 'open') {
          await sql`
            UPDATE rent_periods
            SET status = 'open', resolved_at = NULL, resolved_by = NULL
            WHERE id = ${p.id}
          `;
          await recompute(p.id);
          return json({ ok: true });
        }

        return json({ error: 'invalid status' }, 400);
      }

      return json({ error: 'unknown action' }, 400);
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (err) {
    console.error(err);
    return json({ error: err.message }, 500);
  }
};

export const config = {
  path: '/api/payments',
};
