import { neon } from '@netlify/neon';
const sql = neon();

export default async () => {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS properties (
        id SERIAL PRIMARY KEY,
        property_name TEXT NOT NULL,
        address TEXT,
        contact_name TEXT,
        contact_phone TEXT,
        contact_email TEXT,
        current_rent NUMERIC(10,2),
        next_payment_date DATE,
        rent_change_date DATE,
        new_rent_amount NUMERIC(10,2),
        notes TEXT,
        last_payment_alert_sent DATE,
        last_rent_change_alert_sent DATE,
        created_at TIMESTAMP DEFAULT now()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        notification_emails TEXT[] NOT NULL DEFAULT '{}',
        CONSTRAINT settings_single_row CHECK (id = 1)
      )
    `;
    await sql`
      INSERT INTO settings (id, notification_emails)
      VALUES (1, '{}')
      ON CONFLICT (id) DO NOTHING
    `;

    // Legacy single-admin table — kept so nothing else breaks. No longer used for login.
    await sql`
      CREATE TABLE IF NOT EXISTS admin_user (
        id INTEGER PRIMARY KEY DEFAULT 1,
        email TEXT,
        password_hash TEXT,
        password_salt TEXT,
        session_token TEXT,
        reset_token TEXT,
        reset_token_expires TIMESTAMP,
        created_at TIMESTAMP DEFAULT now(),
        CONSTRAINT admin_single_row CHECK (id = 1)
      )
    `;

    // New multi-user team table
    await sql`
      CREATE TABLE IF NOT EXISTS team_user (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        password_salt TEXT,
        role TEXT NOT NULL DEFAULT 'member',
        session_token TEXT,
        reset_token TEXT,
        reset_token_expires TIMESTAMP,
        invite_token TEXT,
        invite_token_expires TIMESTAMP,
        invited_by INTEGER,
        created_at TIMESTAMP DEFAULT now()
      )
    `;

    // One-time migration: move the existing single admin account into team_user as the owner
    const [existingAdmin] = await sql`SELECT * FROM admin_user WHERE id = 1`;
    if (existingAdmin && existingAdmin.email) {
      await sql`
        INSERT INTO team_user (email, password_hash, password_salt, role, session_token)
        VALUES (${existingAdmin.email}, ${existingAdmin.password_hash}, ${existingAdmin.password_salt}, 'owner', ${existingAdmin.session_token})
        ON CONFLICT (email) DO NOTHING
      `;
    }

    return new Response(
      'Success! Tables are ready. Your existing account is now the team owner. You can delete this file now.',
      { headers: { 'Content-Type': 'text/plain' } }
    );
  } catch (err) {
    return new Response('Error: ' + err.message, { status: 500 });
  }
};

export const config = {
  path: '/api/init-db',
};
