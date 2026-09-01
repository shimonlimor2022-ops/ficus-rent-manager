import { neon } from '@netlify/neon';
import { Resend } from 'resend';
const sql = neon();
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL; // must be on a domain verified in Resend

function paymentEmailHtml(p) {
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#111008">
    <p>Reminder: <b>${p.property_name}</b> is due for a rent payment of <b>€${p.current_rent ?? '—'}</b> today.</p>
    <p style="color:#6B6560;">Please confirm the payment was received from ${p.contact_name || 'the tenant'}${p.contact_phone ? ' (' + p.contact_phone + ')' : ''}.</p>
  </div>`;
}
function rentChangeEmailHtml(p) {
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#111008">
    <p>Reminder: the rent for <b>${p.property_name}</b> has changed to <b>€${p.new_rent_amount}</b>, effective today.</p>
    <p style="color:#6B6560;">Previous rent was €${p.current_rent ?? '—'}.</p>
  </div>`;
}
function leaseExpiryEmailHtml(p, dateStr) {
  const client = p.contact_name || 'the tenant';
  const address = p.address || p.property_name;
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#111008">
    <p>The lease agreement for client ${client}, for the property at address ${address}, is set to expire on ${dateStr}.</p>
  </div>`;
}

export default async () => {
  if (!process.env.RESEND_API_KEY || !FROM_EMAIL) {
    console.error('Missing RESEND_API_KEY or RESEND_FROM_EMAIL env vars — skipping run.');
    return new Response('missing config', { status: 500 });
  }
  const [settingsRow] = await sql`SELECT notification_emails FROM settings WHERE id = 1`;
  const recipients = settingsRow?.notification_emails || [];
  const results = { paymentReminders: 0, rentChanges: 0, leaseExpiry3mo: 0, leaseExpiry1wk: 0, errors: [] };
  if (recipients.length === 0) {
    console.warn('No notification_emails configured in settings — no alerts will be sent.');
    return new Response(JSON.stringify({ ...results, warning: 'no recipients configured' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const paymentsDue = await sql`
      SELECT * FROM properties
      WHERE next_payment_date = CURRENT_DATE
        AND (last_payment_alert_sent IS DISTINCT FROM CURRENT_DATE)
    `;
    for (const p of paymentsDue) {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: recipients,
        subject: `Rent payment due today — ${p.property_name}`,
        html: paymentEmailHtml(p),
      });
      await sql`
        UPDATE properties SET
          last_payment_alert_sent = CURRENT_DATE,
          next_payment_date = next_payment_date + INTERVAL '1 month'
        WHERE id = ${p.id}
      `;
      results.paymentReminders++;
    }

    const rentChanges = await sql`
      SELECT * FROM properties
      WHERE rent_change_date = CURRENT_DATE
        AND (last_rent_change_alert_sent IS DISTINCT FROM CURRENT_DATE)
    `;
    for (const p of rentChanges) {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: recipients,
        subject: `Rent change effective today — ${p.property_name}`,
        html: rentChangeEmailHtml(p),
      });
      await sql`
        UPDATE properties SET
          current_rent = new_rent_amount,
          rent_change_date = NULL,
          new_rent_amount = NULL,
          last_rent_change_alert_sent = CURRENT_DATE
        WHERE id = ${p.id}
      `;
      results.rentChanges++;
    }

    const leases3mo = await sql`
      SELECT * FROM properties
      WHERE lease_expiry_date = CURRENT_DATE + INTERVAL '3 months'
        AND lease_auto_renew IS NOT TRUE
        AND (alert_3mo_sent IS NOT TRUE)
    `;
    for (const p of leases3mo) {
      const dateStr = new Date(p.lease_expiry_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      await resend.emails.send({
        from: FROM_EMAIL,
        to: recipients,
        subject: `Lease expiring in 3 months — ${p.property_name}`,
        html: leaseExpiryEmailHtml(p, dateStr),
      });
      await sql`UPDATE properties SET alert_3mo_sent = TRUE WHERE id = ${p.id}`;
      results.leaseExpiry3mo++;
    }

    const leases1wk = await sql`
      SELECT * FROM properties
      WHERE lease_expiry_date = CURRENT_DATE + INTERVAL '7 days'
        AND lease_auto_renew IS NOT TRUE
        AND (alert_1wk_sent IS NOT TRUE)
    `;
    for (const p of leases1wk) {
      const dateStr = new Date(p.lease_expiry_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      await resend.emails.send({
        from: FROM_EMAIL,
        to: recipients,
        subject: `Lease expiring in 1 week — ${p.property_name}`,
        html: leaseExpiryEmailHtml(p, dateStr),
      });
      await sql`UPDATE properties SET alert_1wk_sent = TRUE WHERE id = ${p.id}`;
      results.leaseExpiry1wk++;
    }
  } catch (err) {
    console.error(err);
    results.errors.push(err.message);
  }
  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const config = {
  schedule: '0 6 * * *', // 06:00 UTC daily ≈ 08:00–09:00 Athens time depending on DST
};
