# Deploying this page

## Folder structure
This package is already set up correctly — keep it exactly as is:

```
index.html                    ← the workshop page (already renamed for you)
steven-photo.jpg              ← your host photo, same folder as index.html
netlify/functions/register.js ← the backend that saves leads to Follow Up Boss
```

## 1. Connect Follow Up Boss (for the "Reserve My Seat" and calculator forms)
Both forms on the page POST to `/.netlify/functions/register`, which forwards
the lead to Follow Up Boss. To activate it:

1. **Get your API key** — Follow Up Boss → Admin → API.
2. **Register a System** — Follow Up Boss requires every integration to
   identify itself with an `X-System` name and `X-System-Key`, separate from
   your API key. Register one here:
   https://docs.followupboss.com/docs/start-here-brand-new-integration
3. **Add environment variables in Netlify** — Site settings → Environment
   variables:
   - `FUB_API_KEY`
   - `FUB_SYSTEM`
   - `FUB_SYSTEM_KEY`
4. **Deploy.** New registrations will show up in Follow Up Boss → People,
   with the registration or calculator request logged in their timeline.

Until these env variables are set, the forms will still show the person a
success message (so the page never looks broken to a visitor), but nothing
will be saved — check the browser console or Netlify function logs to
confirm delivery once it's configured.

## 2. Add your photo
Drop a photo file named `steven-photo.jpg` in the same folder as the HTML
file (same level, not in a subfolder). It'll automatically replace the "S"
placeholder circle in the "Your host" section — no code changes needed. Any
image works as long as the filename matches; JPG or PNG both are fine (just
update the `src` in the HTML if you use a different filename or extension).

## 3. Confirm the countdown & session day
The Wednesday 6:00 PM Pacific countdown logic lives near the bottom of the
HTML file inside the `<script>` tag, in the `nextSession()` function — change
the day number (`3` = Wednesday) or the hour (`18` = 6 PM) if that ever
changes.
