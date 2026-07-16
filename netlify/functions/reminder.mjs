// netlify/functions/reminder.mjs
//
// Scheduled function: runs automatically every Wednesday at 16:00 UTC
// (9:00 AM Pacific during daylight saving; 8:00 AM in winter) and emails
// a session reminder to every registrant who hasn't unsubscribed.
//
// ── CHANGING THE SCHEDULE ─────────────────────────────────────────────
// The line at the bottom controls when this runs, in cron syntax (UTC!):
//     schedule: '0 16 * * 3'
//                │  │      └── day of week: 0=Sun, 1=Mon, ... 3=Wed, 6=Sat
//                │  └── hour in UTC (16:00 UTC ≈ 9 AM Pacific in summer)
//                └── minute
// Examples:
//   Tuesdays 8 AM Pacific (summer) -> '0 15 * * 2'
//   Same day as the meeting, 3 hrs before a 6 PM PT start -> '0 22 * * 3'
// If you change the workshop day/time, update BOTH this cron line AND the
// WORKSHOP config at the top of index.html, plus the wording below.
// ──────────────────────────────────────────────────────────────────────
//
// Uses the same env vars as register.mjs:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
//   FROM_EMAIL, ZOOM_LINK, SITE_URL

function sb(path, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
}

function reminderHtml({ firstName, zoomLink, unsubUrl }) {
  const name = firstName ? firstName.trim() : 'there';
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1c2620;">
    <div style="background:#1c3b2e;border-radius:14px;padding:28px;color:#ffffff;">
      <h1 style="margin:0 0 6px;font-size:22px;">We're live today 🔴</h1>
      <p style="margin:0;color:#cfe0d3;font-size:15px;">The Estate Sale Workshop — today at 6:00 PM Pacific.</p>
    </div>
    <div style="padding:26px 6px;">
      <p style="font-size:15px;">Hi ${name},</p>
      <p style="font-size:15px;">Quick reminder — the free Estate Sale Workshop is <strong>today at 6:00 PM Pacific</strong> on Zoom. Bring your questions.</p>
      <p style="text-align:center;margin:26px 0;">
        <a href="${zoomLink}" style="background:#c99a4b;color:#132a20;text-decoration:none;font-weight:bold;padding:14px 30px;border-radius:999px;font-size:16px;display:inline-block;">Join Tonight's Zoom</a>
      </p>
      <p style="font-size:14px;color:#4a5750;">Can't make it? You'll get the replay — no action needed.</p>
      <p style="font-size:14px;">See you tonight,<br>Steven</p>
    </div>
    <div style="border-top:1px solid #e4e1d5;padding:14px 6px;font-size:11px;color:#8b978f;">
      You're receiving weekly reminders because you registered for the workshop.
      ${unsubUrl ? `<a href="${unsubUrl}" style="color:#8b978f;">Unsubscribe</a>` : ''}
    </div>
  </div>`;
}

export default async () => {
  const { RESEND_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!RESEND_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Reminder: missing environment variables — aborting.');
    return new Response('Not configured', { status: 500 });
  }

  const zoomLink = process.env.ZOOM_LINK || 'http://bit.ly/steven-wener';
  const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');

  // Everyone still subscribed (both workshop signups and calculator leads)
  const res = await sb('registrations?unsubscribed=eq.false&select=email,first_name,unsub_token');
  if (!res.ok) {
    console.error('Reminder: could not fetch registrants:', res.status, await res.text());
    return new Response('Fetch failed', { status: 502 });
  }
  const people = await res.json();
  console.log(`Reminder: sending to ${people.length} registrant(s).`);

  let sent = 0, failed = 0;
  for (const p of people) {
    const unsubUrl = siteUrl && p.unsub_token ? `${siteUrl}/api/unsubscribe?t=${p.unsub_token}` : null;
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.FROM_EMAIL || 'Workshop <onboarding@resend.dev>',
          to: [p.email],
          subject: "Tonight 6 PM PT — your Estate Sale Workshop Zoom link",
          html: reminderHtml({ firstName: p.first_name, zoomLink, unsubUrl })
        })
      });
      if (r.ok) sent++;
      else { failed++; console.error(`Reminder: Resend rejected ${p.email}:`, r.status, await r.text()); }
      // Resend free tier allows 2 requests/second — pace ourselves.
      await new Promise(done => setTimeout(done, 600));
    } catch (err) {
      failed++;
      console.error(`Reminder: error emailing ${p.email}:`, err);
    }
  }

  console.log(`Reminder finished: ${sent} sent, ${failed} failed.`);
  return new Response(`Sent ${sent}, failed ${failed}`, { status: 200 });
};

export const config = {
  schedule: '0 16 * * 3' // Wednesdays 16:00 UTC ≈ 9 AM Pacific (see notes above)
};
