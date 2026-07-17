// netlify/functions/schedule.mjs
//
// GET /api/schedule -> { day, hour, minute, duration }
// Serves the workshop schedule from the Supabase `settings` table so the
// page's countdown can be changed from the Supabase dashboard with no
// code edits or redeploys. Returns safe defaults if anything is missing.

const DEFAULTS = { day: 3, hour: 18, minute: 0, duration: 60 };

export default async () => {
  let out = { ...DEFAULTS };
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/settings?select=key,value`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (res.ok) {
      const rows = await res.json();
      const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
      const num = (v, fallback) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
      };
      out = {
        day: Math.min(6, Math.max(0, num(map.workshop_day, DEFAULTS.day))),
        hour: Math.min(23, Math.max(0, num(map.workshop_hour, DEFAULTS.hour))),
        minute: Math.min(59, Math.max(0, num(map.workshop_minute, DEFAULTS.minute))),
        duration: Math.max(1, num(map.workshop_duration, DEFAULTS.duration))
      };
    }
  } catch (err) {
    console.error('schedule: falling back to defaults:', err);
  }
  return Response.json(out, {
    status: 200,
    headers: { 'Cache-Control': 'public, max-age=60' } // visitors re-check every minute
  });
};

export const config = { path: '/api/schedule' };
