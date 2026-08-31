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

    await sql`ALTER TABLE team_user ADD COLUMN IF NOT EXISTS last_login TIMESTAMP`;

    const [existingAdmin] = await sql`SELECT * FROM admin_user WHERE id = 1`;
    if (existingAdmin && existingAdmin.email) {
      await sql`
        INSERT INTO team_user (email, password_hash, password_salt, role, session_token)
        VALUES (${existingAdmin.email}, ${existingAdmin.password_hash}, ${existingAdmin.password_salt}, 'owner', ${existingAdmin.session_token})
        ON CONFLICT (email) DO NOTHING
      `;
    }

        await sql`
      ALTER TABLE properties
        ADD COLUMN IF NOT EXISTS tax_type TEXT DEFAULT 'stamp',
        ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2) DEFAULT 3.6,
        ADD COLUMN IF NOT EXISTS lease_expiry_date DATE,
        ADD COLUMN IF NOT EXISTS lease_auto_renew BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS due_day INTEGER,
        ADD COLUMN IF NOT EXISTS alert_3mo_sent BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS alert_1wk_sent BOOLEAN DEFAULT false
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS property_payments (
        id SERIAL PRIMARY KEY,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        paid_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT now(),
        updated_by TEXT,
        UNIQUE(property_id, year, month)
      )
    `;return new Response(
      'Success! Tables are ready, including last_login tracking.',
      { headers: { 'Content-Type': 'text/plain' } }
    );
  } catch (err) {
    return new Response('Error: ' + err.message, { status: 500 });
  }
};

export const config = {
  path: '/api/init-db',
};
