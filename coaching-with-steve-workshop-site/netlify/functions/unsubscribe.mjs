// netlify/functions/unsubscribe.mjs
//
// Handles the "Unsubscribe" link in the emails: /api/unsubscribe?t=<token>
// Flips the person's `unsubscribed` flag in Supabase and shows a small
// confirmation page. Tokens are random UUIDs generated per registrant,
// so nobody can unsubscribe anyone else by guessing.

function page(title, body) {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
     <title>${title}</title></head>
     <body style="font-family:Arial,Helvetica,sans-serif;background:#f6f3ec;color:#1c2620;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
       <div style="background:#ffffff;border-radius:16px;padding:40px;max-width:420px;text-align:center;box-shadow:0 10px 24px rgba(28,38,32,.1);">
         <h1 style="font-size:22px;margin:0 0 10px;">${title}</h1>
         <p style="font-size:15px;color:#4a5750;margin:0;">${body}</p>
       </div>
     </body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

export default async (req) => {
  const token = new URL(req.url).searchParams.get('t');
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!token || !uuidPattern.test(token)) {
    return page('Link not recognized', 'This unsubscribe link looks incomplete. Try clicking it again from your email.');
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/registrations?unsub_token=eq.${token}`,
      {
        method: 'PATCH',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify({ unsubscribed: true })
      }
    );
    const rows = res.ok ? await res.json() : [];
    if (!rows.length) {
      return page('Link not recognized', 'We could not find a matching registration. You may already be unsubscribed.');
    }
  } catch (err) {
    console.error('Unsubscribe error:', err);
    return page('Something went wrong', 'Please try the link again in a moment.');
  }

  return page("You're unsubscribed", 'You will no longer receive weekly workshop reminders. You can re-register any time if you change your mind.');
};

export const config = { path: '/api/unsubscribe' };
