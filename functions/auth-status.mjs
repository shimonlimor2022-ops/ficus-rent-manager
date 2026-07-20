import { sql, getSessionUser, json } from '../lib/auth.mjs';

export default async (req) => {
  const [anyUser] = await sql`SELECT id FROM team_user LIMIT 1`;
  const user = await getSessionUser(req);

  return json({
    registered: !!anyUser,
    authenticated: !!user,
    email: user ? user.email : null,
    role: user ? user.role : null,
  });
};

export const config = {
  path: '/api/auth-status',
};
