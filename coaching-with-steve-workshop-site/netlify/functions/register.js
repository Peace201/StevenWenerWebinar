// netlify/functions/register.js
//
// Receives registrations from the workshop page (both the "Reserve My Seat"
// form and the probate calculator's "Email me this estimate" form) and
// forwards them to Follow Up Boss as a new Event, which creates or updates
// the matching Person in your CRM.
//
// ----------------------------------------------------------------------
// ONE-TIME SETUP (required before this works — do these in order):
//
// 1. Get your personal API key:
//    Follow Up Boss → Admin → API → copy your API key.
//
// 2. Register a "System" (Follow Up Boss requires this from every
//    integration, separate from your API key):
//    https://docs.followupboss.com/docs/start-here-brand-new-integration
//    This gives you an X-System name and an X-System-Key value.
//
// 3. In Netlify: Site settings → Environment variables → add:
//      FUB_API_KEY    = your personal API key from step 1
//      FUB_SYSTEM     = the system name from step 2
//      FUB_SYSTEM_KEY = the system key from step 2
//
// 4. Deploy this file at netlify/functions/register.js (already placed
//    correctly if you keep this folder structure). The page's forms POST
//    to /.netlify/functions/register automatically once deployed.
//
// 5. Test: submit the form on the live site, then check Follow Up Boss →
//    People. The new contact's timeline should show the event.
// ----------------------------------------------------------------------

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: 'Invalid JSON body' };
  }

  const { firstName, email, phone, source, message } = data;

  if (!email) {
    return { statusCode: 400, body: 'Email is required' };
  }

  const { FUB_API_KEY, FUB_SYSTEM, FUB_SYSTEM_KEY } = process.env;
  if (!FUB_API_KEY || !FUB_SYSTEM || !FUB_SYSTEM_KEY) {
    console.error('Missing Follow Up Boss environment variables.');
    return { statusCode: 500, body: 'Server is not configured yet — see setup notes in register.js' };
  }

  const payload = {
    source: 'coachingwithsteve.com',
    system: FUB_SYSTEM,
    type: 'Registration',
    message:
      message ||
      (source === 'calculator'
        ? 'Requested a probate fee estimate via the calculator'
        : 'Registered for the free Estate Sale Workshop (Zoom)'),
    person: {
      firstName: firstName || undefined,
      emails: [{ value: email }],
      phones: phone ? [{ value: phone }] : undefined
    }
  };

  try {
    const res = await fetch('https://api.followupboss.com/v1/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${FUB_API_KEY}:`).toString('base64'),
        'X-System': FUB_SYSTEM,
        'X-System-Key': FUB_SYSTEM_KEY
      },
      body: JSON.stringify(payload)
    });

    const bodyText = await res.text();

    if (!res.ok) {
      console.error('Follow Up Boss rejected the request:', res.status, bodyText);
      return { statusCode: 502, body: 'Follow Up Boss rejected the request' };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true })
    };
  } catch (err) {
    console.error('Error calling Follow Up Boss:', err);
    return { statusCode: 500, body: 'Server error contacting Follow Up Boss' };
  }
};
