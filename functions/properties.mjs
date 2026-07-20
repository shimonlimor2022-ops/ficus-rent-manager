import { neon } from '@netlify/neon';
import { isAuthenticated, json as authJson } from '../lib/auth.mjs';

const sql = neon(); // uses NETLIFY_DATABASE_URL automatically

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
      const rows = await sql`
        SELECT * FROM properties
        ORDER BY property_name ASC
      `;
      return json(rows);
    }

    if (req.method === 'POST') {
      const b = await req.json();
      if (!b.property_name) return json({ error: 'property_name is required' }, 400);
      const [row] = await sql`
        INSERT INTO properties (
          property_name, address,
          contact_name, contact_phone, contact_email,
          current_rent, next_payment_date,
          rent_change_date, new_rent_amount,
          notes
        ) VALUES (
          ${b.property_name}, ${b.address || null},
          ${b.contact_name || null}, ${b.contact_phone || null}, ${b.contact_email || null},
          ${b.current_rent || null}, ${b.next_payment_date || null},
          ${b.rent_change_date || null}, ${b.new_rent_amount || null},
          ${b.notes || null}
        )
        RETURNING *
      `;
      return json(row, 201);
    }

    if (req.method === 'PUT') {
      const b = await req.json();
      if (!b.id) return json({ error: 'missing id' }, 400);
      if (!b.property_name) return json({ error: 'property_name is required' }, 400);
      const [row] = await sql`
        UPDATE properties SET
          property_name = ${b.property_name},
          address = ${b.address || null},
          contact_name = ${b.contact_name || null},
          contact_phone = ${b.contact_phone || null},
          contact_email = ${b.contact_email || null},
          current_rent = ${b.current_rent || null},
          next_payment_date = ${b.next_payment_date || null},
          rent_change_date = ${b.rent_change_date || null},
          new_rent_amount = ${b.new_rent_amount || null},
          notes = ${b.notes || null}
        WHERE id = ${b.id}
        RETURNING *
      `;
      if (!row) return json({ error: 'not found' }, 404);
      return json(row);
    }

    if (req.method === 'DELETE') {
      const { id } = await req.json();
      if (!id) return json({ error: 'missing id' }, 400);
      await sql`DELETE FROM properties WHERE id = ${id}`;
      return json({ ok: true });
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (err) {
    console.error(err);
    return json({ error: err.message }, 500);
  }
};

export const config = {
  path: '/api/properties',
};
