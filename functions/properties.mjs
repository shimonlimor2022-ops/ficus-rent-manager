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
      const taxType = b.tax_type === 'vat' ? 'vat' : 'stamp';
      const [row] = await sql`
        INSERT INTO properties (
          property_name, address,
          contact_name, contact_phone, contact_email,
          current_rent, next_payment_date,
          rent_change_date, new_rent_amount,
          notes,
          tax_type, tax_rate,
          lease_expiry_date, lease_auto_renew, due_day
        ) VALUES (
          ${b.property_name}, ${b.address || null},
          ${b.contact_name || null}, ${b.contact_phone || null}, ${b.contact_email || null},
          ${b.current_rent || null}, ${b.next_payment_date || null},
          ${b.rent_change_date || null}, ${b.new_rent_amount || null},
          ${b.notes || null},
          ${taxType}, ${b.tax_rate || null},
          ${b.lease_expiry_date || null}, ${!!b.lease_auto_renew}, ${b.due_day || null}
        )
        RETURNING *
      `;
      return json(row, 201);
    }
    if (req.method === 'PUT') {
      const b = await req.json();
      if (!b.id) return json({
