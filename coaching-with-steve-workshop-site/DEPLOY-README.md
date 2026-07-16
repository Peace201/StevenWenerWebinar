# Deploying this site (Supabase + Resend setup)

## What's in this package
```
index.html                       ← the workshop page (timer settings at top of its <script>)
steven-photo.jpg                 ← host photo (must stay next to index.html)
supabase-setup.sql               ← run once in Supabase: creates the tables
supabase-update-1.sql            ← run once in Supabase: adds unsubscribe columns
netlify/functions/register.mjs   ← saves registration + sends confirmation email
netlify/functions/reminder.mjs   ← auto-emails all registrants before each session
netlify/functions/unsubscribe.mjs← handles the unsubscribe link in emails
```

## How registrations flow
Form submitted → Netlify function validates it → row inserted into your
Supabase `registrations` table. View, search, and export registrations any
time in the Supabase dashboard (Table Editor → registrations).

Built-in protections:
- **Duplicate emails** — a UNIQUE constraint in the database itself makes a
  second registration physically impossible; the visitor sees a friendly
  "you're already registered" message instead.
- **The +alias trick** (steven+1@gmail.com, steven+2@gmail.com…) — emails are
  normalized (lowercased, +suffix stripped, gmail dots removed) before the
  uniqueness check, so all variants count as one person.
- **Rate limiting** — max 5 submissions per hour per IP address. Scripts get
  a 429; the page shows a polite "try again in an hour" message.

## One-time setup (about 5 minutes)

### 1. Create the Supabase project & tables
- Sign in at supabase.com (free tier is fine) → New project.
- Once it's ready: **SQL Editor** → paste the contents of
  `supabase-setup.sql` → **Run**. That creates the two tables and locks
  them down so only your backend can touch them.

### 2. Copy two values from Supabase
Project **Settings → API**:
- **Project URL** (looks like `https://abcdefgh.supabase.co`)
- **service_role key** (under "Project API keys" — the SECRET one, not anon)

⚠️ The service_role key is a master key. It only ever goes into Netlify's
environment variables (server-side). Never paste it into index.html or
share it in chat/email.

### 3. Add them in Netlify
Site configuration → Environment variables → add:
```
SUPABASE_URL              = (your Project URL)
SUPABASE_SERVICE_ROLE_KEY = (your sb_secret_... key)
RESEND_API_KEY            = (from Resend, step 6 below)
FROM_EMAIL                = Steven <workshop@coachingwithsteve.com>
ZOOM_LINK                 = http://bit.ly/steven-wener
SITE_URL                  = https://YOUR-SITE.netlify.app   (no trailing slash)
```

### 6. Set up Resend (email sending) — about 10 minutes
1. Create a free account at resend.com (3,000 emails/month free).
2. **Verify your domain:** Resend → Domains → Add Domain →
   `coachingwithsteve.com`. Resend shows a few DNS records (TXT/MX/CNAME) —
   add them wherever your domain is registered (GoDaddy, Namecheap, etc.),
   then click Verify. Until this is done, Resend can only email YOU.
3. Resend → API Keys → Create → copy it into Netlify as RESEND_API_KEY.
4. Run `supabase-update-1.sql` in the Supabase SQL Editor (adds the
   unsubscribe columns the emails need).
5. Redeploy the site so the new variables and functions go live.

**What the emails do:**
- Instant confirmation with the Zoom link on every new registration.
- Automatic reminder to ALL subscribed registrants every Wednesday at
  ~9 AM Pacific (the schedule lives at the bottom of
  netlify/functions/reminder.mjs — instructions for changing it are in
  that file's comments).
- Every email includes an unsubscribe link (required by law for
  recurring emails); unsubscribes are handled automatically.

### 4. Deploy
Drag this folder into Netlify (or connect via Git). The function deploys
automatically at /api/register.

### 5. Test
- Submit the live form once → a row appears in Supabase → Table Editor →
  registrations.
- Submit the SAME email again (or a +1 variant of it) → the page says
  "you're already registered" and NO new row appears.

## Maintenance notes
- To clear test registrations: Supabase → Table Editor → registrations →
  select rows → delete. Rate-limit counters live in the rate_limits table
  and reset themselves after an hour.
- **Changing the meeting day/time:** open index.html and find the WORKSHOP
  config near the top of the <script> at the bottom of the file — one line
  controls the countdown, e.g. { day: 3, hour: 18, minute: 0,
  durationMinutes: 60 } (day: 0=Sun … 6=Sat, hour in 24h Pacific time).
  Also update: the visible text on the page ("Wednesdays 6:00 PM"), the
  reminder schedule in netlify/functions/reminder.mjs, and the wording in
  the two email templates.
- The host photo is loaded by filename: keep steven-photo.jpg in the same
  folder as index.html.
- Want the team notified of each signup (Slack, email, etc.)? Supabase
  Database Webhooks can fire on every new registrations row — no code
  changes needed here.
