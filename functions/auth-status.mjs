import { sql, isAuthenticated, json } from '../lib/auth.mjs';

export default async (req) => {
  const [row] = await sql`SELECT id, email FROM admin_user WHERE id = 1`;
  const authed = await isAuthenticated(req);
  return json({ registered: !!row, authenticated: authed, email: authed ? row.email : null });
};

export const config = {
  path: '/api/auth-status',
};
