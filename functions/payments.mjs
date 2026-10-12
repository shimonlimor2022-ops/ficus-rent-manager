import { neon } from '@netlify/neon';
import { Resend } from 'resend';
import { isAuthenticated, getSessionUser, json } from '../lib/auth.mjs';
const sql = neon();
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL;
const APP_URL = process.env.URL || 'https://ornate-trifle-4d0713.netlify.app';
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function escHtml(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function eur(x) {
  return '€' + Number(x || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function niceDate(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return d + ' ' + MONTH_NAMES[m - 1] + ' ' + y;
}
const STATUS_TEXT = { paid: 'Paid', partial: 'Partially paid', unpaid: 'Not paid', open: 'Open' };

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

      if (view === 'latest') {
        const rows = await sql`
          SELECT DISTINCT ON (x.property_id)
                 x.property_id, x.due_date, x.expected_amount, x.status, x.paid_total,
                 (SELECT COUNT(*)::int FROM rent_periods q
                   WHERE q.property_id = x.property_id
                     AND q.due_date <= CURRENT_DATE
                     AND q.status IN ('open', 'partial', 'unpaid')) AS not_paid_count
          FROM (
            SELECT p.id, p.property_id, to_char(p.due_date, 'YYYY-MM-DD') AS due_date,
                   p.expected_amount, p.status, COALESCE(SUM(e.amount), 0) AS paid_total
            FROM rent_periods p
            LEFT JOIN rent_payment_entries e ON e.period_id = p.id
            WHERE p.due_date <= CURRENT_DATE
            GROUP BY p.id
          ) x
          ORDER BY x.property_id, x.due_date DESC
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

      if (action === 'email_summary') {
        const month = parseInt(b.month, 10);
        const year = parseInt(b.year, 10);
        if (!(month >= 1 && month <= 12) || !(year >= 2000 && year <= 2100)) {
          return json({ error: 'invalid month or year' }, 400);
        }
        const [settingsRow] = await sql`SELECT notification_emails FROM settings WHERE id = 1`;
        const recipients = settingsRow?.notification_emails || [];
        if (!recipients.length) {
          return json({ error: 'No notification emails are set. Add them in Settings first.' }, 400);
        }
        const rows = await sql`
          SELECT p.id, to_char(p.due_date, 'YYYY-MM-DD') AS due_date,
                 p.expected_amount, p.status,
                 pr.property_name, pr.contact_name,
                 COALESCE(SUM(e.amount), 0) AS paid_total
          FROM rent_periods p
          JOIN properties pr ON pr.id = p.property_id
          LEFT JOIN rent_payment_entries e ON e.period_id = p.id
          WHERE EXTRACT(MONTH FROM p.due_date) = ${month}
            AND EXTRACT(YEAR FROM p.due_date) = ${year}
          GROUP BY p.id, pr.id
          ORDER BY p.due_date ASC, pr.property_name ASC
        `;
        let opening = 0, paid = 0, out = 0;
        const lines = rows.map((r) => {
          const exp = r.expected_amount === null ? 0 : Number(r.expected_amount);
          const pt = Number(r.paid_total);
          const rem = r.status === 'paid' || r.expected_amount === null ? 0 : Math.max(0, exp - pt);
          opening += exp; paid += pt; out += rem;
          return '<tr>' +
            '<td style="padding:8px;border:1px solid #D6D0C8;">' + escHtml(r.property_name) + '<br><span style="color:#6B6560;font-size:12px;">' + escHtml(r.contact_name || '') + '</span></td>' +
            '<td style="padding:8px;border:1px solid #D6D0C8;">' + niceDate(r.due_date) + '</td>' +
            '<td style="padding:8px;border:1px solid #D6D0C8;text-align:right;">' + eur(exp) + '</td>' +
            '<td style="padding:8px;border:1px solid #D6D0C8;text-align:right;">' + eur(pt) + '</td>' +
            '<td style="padding:8px;border:1px solid #D6D0C8;text-align:right;">' + eur(rem) + '</td>' +
            '<td style="padding:8px;border:1px solid #D6D0C8;">' + (STATUS_TEXT[r.status] || r.status) + '</td>' +
            '</tr>';
        }).join('');
        const label = MONTH_NAMES[month - 1] + ' ' + year;
        const html =
          '<div style="font-family:Arial,sans-serif;color:#111008;max-width:680px;">' +
          '<h2 style="margin:0 0 4px;">Ficus Investments – Monthly Rent Summary</h2>' +
          '<div style="color:#6B6560;margin-bottom:16px;">' + label + '</div>' +
          '<table style="border-collapse:collapse;width:100%;font-size:13px;">' +
          '<thead><tr style="background:#EEF3F8;">' +
          '<th style="padding:8px;border:1px solid #D6D0C8;text-align:left;">Property</th>' +
          '<th style="padding:8px;border:1px solid #D6D0C8;text-align:left;">Due</th>' +
          '<th style="padding:8px;border:1px solid #D6D0C8;text-align:right;">Expected</th>' +
          '<th style="padding:8px;border:1px solid #D6D0C8;text-align:right;">Paid</th>' +
          '<th style="padding:8px;border:1px solid #D6D0C8;text-align:right;">Remaining</th>' +
          '<th style="padding:8px;border:1px solid #D6D0C8;text-align:left;">Status</th>' +
          '</tr></thead><tbody>' +
          (lines || '<tr><td colspan="6" style="padding:14px;text-align:center;color:#6B6560;">No payments came due in this month.</td></tr>') +
          '</tbody></table>' +
          '<p style="margin:16px 0;font-size:14px;">Opening balance: <b>' + eur(opening) + '</b> &nbsp;·&nbsp; Paid: <b>' + eur(paid) +
          '</b> &nbsp;·&nbsp; Outstanding: <b>' + eur(out) + '</b></p>' +
          '<p style="margin:20px 0;"><a href="' + APP_URL + '" style="background:#111008;color:#fff;padding:10px 18px;border-radius:99px;text-decoration:none;font-size:14px;">Open the app</a></p>' +
          '</div>';
        await resend.emails.send({
          from: FROM_EMAIL,
          to: recipients,
          subject: 'Monthly rent summary – ' + label,
          html,
        });
        return json({ ok: true, sent_to: recipients });
      }

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
