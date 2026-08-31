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

  const url = new URL(req.url);

  try {
    if (req.method === 'GET') {
      const year = Number(url.searchParams.get('year'));
      const month = Number(url.searchParams.get('month'));
      if (!year || !month) return json({ error: 'year and month are required' }, 400);

      const rows = await sql`
        SELECT
          p.id, p.property_name, p.contact_name,
          p.current_rent, p.tax_type, p.tax_rate,
          COALESCE(pp.paid_amount, 0) AS paid_amount,
          pp.updated_at, pp.updated_by
        FROM properties p
        LEFT JOIN property_payments pp
          ON pp.property_id = p.id AND pp.year = ${year} AND pp.month = ${month}
        ORDER BY p.property_name ASC
      `;
      return json(rows);
    }

    if (req.method === 'PUT') {
      const b = await req.json();
      if (!b.property_id || !b.year || !b.month) {
        return json({ error: 'property_id, year and month are required' }, 400);
      }
      const [row] = await sql`
        INSERT INTO property_payments (property_id, year, month, paid_amount, updated_by)
        VALUES (${b.property_id}, ${b.year}, ${b.month}, ${b.paid_amount || 0}, ${b.updated_by || null})
        ON CONFLICT (property_id, year, month)
        DO UPDATE SET paid_amount = ${b.paid_amount || 0}, updated_by = ${b.updated_by || null}, updated_at = now()
        RETURNING *
      `;
      return json(row);
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
