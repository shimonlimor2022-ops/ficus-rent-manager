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

    return new Response(
      'Success! Tables "properties", "settings", and "admin_user" are ready. You can delete this file now.',
      { headers: { 'Content-Type': 'text/plain' } }
    );
  } catch (err) {
    return new Response('Error: ' + err.message, { status: 500 });
  }
};

export const config = {
  path: '/api/init-db',
};
