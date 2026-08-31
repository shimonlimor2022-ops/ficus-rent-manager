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
function monthlySummaryEmailHtml(rows, monthLabel) {
  let expected = 0, paid = 0;
  const bodyRows = rows.map(r => {
    const exp = +(Number(r.current_rent || 0) + Number(r.current_rent || 0) * Number(r.tax_rate || 0) / 100).toFixed(2);
    const pd = Number(r.paid_amount) || 0;
    expected += exp; paid += pd;
    return `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">${r.property_name}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">€${exp.toFixed(2)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;">€${pd.toFixed(2)}</td></tr>`;
  }).join('');
  const unpaid = rows.filter(r => {
    const exp = +(Number(r.current_rent || 0) + Number(r.current_rent || 0) * Number(r.tax_rate || 0) / 100).toFixed(2);
    return (Number(r.paid_amount) || 0) < exp;
  });
  const unpaidHtml = unpaid.length
    ? `<p style="color:#B03018;font-weight:bold;margin-top:16px;">Not yet paid (${unpaid.length}):</p><ul style="color:#B03018;">` +
      unpaid.map(r => `<li>${r.property_name}${r.contact_name ? ' — ' + r.contact_name : ''}</li>`).join('') + '</ul>'
    : `<p style="color:#1A6B30;font-weight:bold;margin-top:16px;">Everyone had paid in full by the end of the month.</p>`;
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#111008;max-width:520px;">
    <p><b>Ficus Investments — Monthly Rent Summary</b></p>
    <p style="color:#6B6560;">${monthLabel}</p>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin-top:12px;">
      <thead><tr><th style="text-align:left;padding:6px 10px;border-bottom:2px solid #111008;">Property</th><th style="text-align:left;padding:6px 10px;border-bottom:2px solid #111008;">Expected</th><th style="text-align:left;padding:6px 10px;border-bottom:2px solid #111008;">Paid</th></tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
    <p style="margin-top:12px;"><b>Total expected: €${expected.toFixed(2)} &nbsp;·&nbsp; Total paid: €${paid.toFixed(2)} &nbsp;·&nbsp; Outstanding: €${(expected - paid).toFixed(2)}</b></p>
    ${unpaidHtml}
  </div>`;
}

export default async () => {
  if (!process.env.RESEND_API_KEY || !FROM_EMAIL) {
    console.error('Missing RESEND_API_KEY or RESEND_FROM_EMAIL env vars — skipping run.');
    return new Response('missing config', { status: 500 });
  }
  const [settingsRow] = await sql`SELECT notification_emails FROM settings WHERE id = 1`;
  const recipients = settingsRow?.notification_emails || [];
  const results = { paymentReminders: 0, rentChanges: 0, leaseExpiry3mo: 0, leaseExpiry1wk: 0, monthlySummarySent: false, errors: [] };
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

    const today = new Date();
    if (today.getUTCDate() === 1) {
      const prev = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const py = prev.getUTCFullYear();
      const pm = prev.getUTCMonth() + 1;
      const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const monthLabel = `${monthNames[pm - 1]} ${py}`;

      const rows = await sql`
        SELECT p.property_name, p.contact_name, p.current_rent, p.tax_rate,
               COALESCE(pp.paid_amount, 0) AS paid_amount
        FROM properties p
        LEFT JOIN property_payments pp
          ON pp.property_id = p.id AND pp.year = ${py} AND pp.month = ${pm}
        ORDER BY p.property_name ASC
      `;
      if (rows.length > 0) {
        await resend.emails.send({
          from: FROM_EMAIL,
          to: recipients,
          subject: `Monthly Rent Summary — ${monthLabel}`,
          html: monthlySummaryEmailHtml(rows, monthLabel),
        });
        results.monthlySummarySent = true;
      }
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
