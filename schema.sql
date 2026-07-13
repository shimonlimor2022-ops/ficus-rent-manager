-- Run this once in the Netlify Database SQL editor (or via `netlify db` / Neon console)
-- before the app is used.

CREATE TABLE IF NOT EXISTS properties (
  id                          SERIAL PRIMARY KEY,
  property_name               TEXT NOT NULL,
  address                     TEXT,
  contact_name                TEXT,
  contact_phone               TEXT,
  contact_email               TEXT,
  current_rent                NUMERIC(10,2),
  next_payment_date           DATE,
  rent_change_date            DATE,
  new_rent_amount             NUMERIC(10,2),
  notes                       TEXT,
  last_payment_alert_sent     DATE,
  last_rent_change_alert_sent DATE,
  created_at                  TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  id                   INTEGER PRIMARY KEY DEFAULT 1,
  notification_emails  TEXT[] NOT NULL DEFAULT '{}',
  CONSTRAINT settings_single_row CHECK (id = 1)
);

INSERT INTO settings (id, notification_emails)
VALUES (1, '{}')
ON CONFLICT (id) DO NOTHING;
