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
  try {
    const res = await sb('registrations', {
      method: 'POST',
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
  } catch (err) {
    console.error('Error inserting registration:', err);
    return Response.json(
      { error: 'Something went wrong saving your registration. Please try again.' },
      { status: 502 }
    );
  }

  return Response.json({ ok: true }, { status: 200 });
};

export const config = { path: '/api/register' };
