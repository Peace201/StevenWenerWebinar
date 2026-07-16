// netlify/functions/register.mjs
//
// Handles registrations from the workshop page ("Reserve My Seat" form and
// the probate calculator's "Email me this estimate" form), storing them in
// Supabase.
//
// What it does, in order:
//   1. Rate-limits by IP (max 5 submissions per hour per IP).
//   2. Normalizes the email (lowercase, strips "+alias" tricks, removes
//      gmail dots) so steven+1@gmail.com / steven+2@gmail.com / s.teven@gmail.com
//      all collapse to the same identity.
//   3. Inserts into the registrations table. A UNIQUE constraint on
//      normalized_email makes duplicates impossible at the database level —
//      a duplicate insert returns a conflict, and the page shows a friendly
//      "you're already registered" message.
//
// Setup steps are in DEPLOY-README.md. Required environment variables:
//   SUPABASE_URL              e.g. https://abcdefgh.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY (Settings -> API -> service_role secret)
//
// The service role key bypasses Row Level Security, which is correct here:
// this code runs only on the server (Netlify function). NEVER put this key
// in the HTML/frontend.

const RATE_LIMIT_MAX = 5;                     // submissions allowed...
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;  // ...per IP per hour

function normalizeEmail(raw) {
  let email = String(raw || '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at === -1) return email;
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);

  // googlemail.com is the same inbox as gmail.com
  if (domain === 'googlemail.com') domain = 'gmail.com';

  // Strip +alias on all providers (steven+123@x.com -> steven@x.com)
  const plus = local.indexOf('+');
  if (plus !== -1) local = local.slice(0, plus);

  // Gmail ignores dots in the local part (s.teven == steven)
  if (domain === 'gmail.com') local = local.replaceAll('.', '');

  return `${local}@${domain}`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

// Minimal Supabase REST helper (PostgREST) — no npm packages needed.
function sb(path, { method = 'GET', body, headers = {} } = {}) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(url, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

// ---- Email via Resend ----
// Env vars: RESEND_API_KEY, FROM_EMAIL (e.g. "Steven <workshop@coachingwithsteve.com>"),
// ZOOM_LINK, SITE_URL (e.g. https://yoursite.netlify.app — used for the unsubscribe link)
async function sendConfirmationEmail({ to, firstName, unsubToken }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY not set — skipping confirmation email.');
    return;
  }
  const zoomLink = process.env.ZOOM_LINK || 'http://bit.ly/steven-wener';
  const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');
  const unsubUrl = siteUrl && unsubToken ? `${siteUrl}/api/unsubscribe?t=${unsubToken}` : null;
  const name = firstName ? firstName.trim() : 'there';

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1c2620;">
    <div style="background:#1c3b2e;border-radius:14px;padding:28px;color:#ffffff;">
      <h1 style="margin:0 0 6px;font-size:22px;">You're registered! 🎉</h1>
      <p style="margin:0;color:#cfe0d3;font-size:15px;">The Estate Sale Workshop — free, live on Zoom.</p>
    </div>
    <div style="padding:26px 6px;">
      <p style="font-size:15px;">Hi ${name},</p>
      <p style="font-size:15px;">Your seat is saved. We meet <strong>every Wednesday at 6:00 PM Pacific</strong>. Join with this link any week:</p>
      <p style="text-align:center;margin:26px 0;">
        <a href="${zoomLink}" style="background:#c99a4b;color:#132a20;text-decoration:none;font-weight:bold;padding:14px 30px;border-radius:999px;font-size:16px;display:inline-block;">Join the Zoom Workshop</a>
      </p>
      <p style="font-size:14px;color:#4a5750;">Can't make it live? No problem — registrants receive the replay. Bring your questions; every session ends with open Q&amp;A.</p>
      <p style="font-size:14px;">See you Wednesday,<br>Steven</p>
    </div>
    <div style="border-top:1px solid #e4e1d5;padding:14px 6px;font-size:11px;color:#8b978f;">
      You're receiving this because you registered at our workshop page.
      ${unsubUrl ? `<a href="${unsubUrl}" style="color:#8b978f;">Unsubscribe from reminders</a>` : ''}
    </div>
  </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.FROM_EMAIL || 'Workshop <onboarding@resend.dev>',
        to: [to],
        subject: "You're in — Zoom link for Wednesday's Estate Sale Workshop",
        html
      })
    });
    if (!res.ok) console.error('Resend rejected confirmation email:', res.status, await res.text());
  } catch (err) {
    console.error('Error sending confirmation email:', err);
  }
}

export default async (req, context) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Supabase environment variables are not configured.');
    return Response.json(
      { error: 'Registration is not configured yet. Please try again later.' },
      { status: 500 }
    );
  }

  let data;
  try {
    data = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { firstName, email, phone, source, message } = data;
  const normalized = normalizeEmail(email);

  if (!isValidEmail(normalized)) {
    return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }

  const ip = context.ip || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();

  // ---- 1. Rate limiting by IP ----
  try {
    const res = await sb(`rate_limits?ip=eq.${encodeURIComponent(ip)}&select=count,window_start`);
    const rows = res.ok ? await res.json() : [];
    const row = rows[0];

    if (row && now - new Date(row.window_start).getTime() <= RATE_LIMIT_WINDOW_MS) {
      if (row.count >= RATE_LIMIT_MAX) {
        return Response.json(
          { error: 'Too many attempts from this connection. Please try again in an hour.' },
          { status: 429 }
        );
      }
      await sb(`rate_limits?ip=eq.${encodeURIComponent(ip)}`, {
        method: 'PATCH',
        body: { count: row.count + 1 }
      });
    } else {
      // New IP, or expired window: upsert a fresh counter
      await sb('rate_limits?on_conflict=ip', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: { ip, count: 1, window_start: new Date(now).toISOString() }
      });
    }
  } catch (err) {
    // If rate limiting hiccups, fail open rather than block real people.
    console.error('Rate limit error:', err);
  }

  // ---- 2 & 3. Insert; the UNIQUE constraint handles duplicates ----
  let insertedRow = null;
  try {
    const res = await sb('registrations', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: {
        first_name: firstName || '',
        email: String(email || '').trim(), // as typed; normalization is internal
        normalized_email: normalized,
        phone: phone || '',
        source: source || 'workshop',
        message: message || ''
      }
    });

    if (res.status === 409) {
      // Unique constraint on normalized_email fired -> already registered
      return Response.json({ alreadyRegistered: true }, { status: 200 });
    }

    if (!res.ok) {
      console.error('Supabase insert failed:', res.status, await res.text());
      return Response.json(
        { error: 'Something went wrong saving your registration. Please try again.' },
        { status: 502 }
      );
    }

    const rows = await res.json().catch(() => []);
    insertedRow = rows[0] || null;
  } catch (err) {
    console.error('Error inserting registration:', err);
    return Response.json(
      { error: 'Something went wrong saving your registration. Please try again.' },
      { status: 502 }
    );
  }

  // ---- 4. Send the confirmation email (never blocks the registration) ----
  await sendConfirmationEmail({
    to: String(email || '').trim(),
    firstName: firstName || '',
    unsubToken: insertedRow?.unsub_token
  });

  return Response.json({ ok: true }, { status: 200 });
};

export const config = { path: '/api/register' };
