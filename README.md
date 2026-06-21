# Procrastinating

Local-first attention tracking for answering questions like:

- What have I been doing today?
- What was I doing in the last hour?
- What did I spend time on this week or this year?
- Was that time mostly fun, functional, mixed, or unknown?
- What can be reconstructed from before the tracker was installed?

The MVP is intentionally local-first. A Chrome extension records active browser sessions and sends them to a local Node/SQLite service. The dashboard reads from that local database.

## Current MVP

- Chrome extension tracks active tab URL, title, browser focus, and idle state.
- Local API stores sessions in `data/attention.sqlite`.
- Dashboard shows today, last hour, this week, this year, and custom "since" ranges.
- Sessions are classified as `functional`, `fun`, `mixed`, or `unknown`.
- You can correct one session or apply a correction to an entire domain.
- Brief same-URL interruptions are merged without counting the away-time as active time.
- Dashboard can export JSON, delete the current range, and delete individual sessions.
- Dashboard can delete all sessions for a domain in the current range.
- Tracking rules let you block domains or switch to allowlist-only tracking.
- Tracking/privacy panel shows the local-only data posture.
- Extension popup warns when the local API is offline.
- Extension popup supports pause, 15-minute pause, and 1-hour pause.
- Google Takeout/Chrome history backfill importer is scaffolded for pre-install history.
- Demo data and verification fixtures are included.

## Run The Local App

Requirements:

- Node.js 24 or newer

Start the local API and dashboard:

```bash
npm run dev
```

Open:

```text
http://localhost:3847
```

Run verification checks:

```bash
npm test
```

Seed demo sessions for today:

```bash
npm run seed:demo
```

## Load The Chrome Extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose "Load unpacked".
4. Select the `extension` folder in this repo.
5. Keep `npm run dev` running so the extension can post to the local API.

The extension ignores incognito/private tabs and browser-internal pages by default.

The extension popup can:

- pause/resume tracking
- pause for 15 minutes
- pause for 1 hour
- open the dashboard
- warn when the local API is not reachable

## Backfill Pre-Install History

Backfilled data can often tell what you visited or watched and when, but usually cannot prove how long you actively spent there. Imported rows are marked as `backfilled`.

Export Google data with Google Takeout, then run:

```bash
npm run import:takeout -- /path/to/Takeout
```

Supported first-pass sources:

- YouTube activity JSON
- Chrome/browser history JSON
- Google Search/My Activity JSON where a URL and timestamp are present

The importer is tested against synthetic fixtures in `tests/fixtures/takeout`. Real Takeout exports may still need format-specific fixes.

## Dashboard Controls

The dashboard supports:

- time windows: today, last hour, this week, this year, and since a custom date
- JSON export for the current range
- delete current range
- delete one session
- delete a domain in the current range
- category corrections for one session or an entire domain
- tracking mode: track all except blocked, or allowlist-only
- domain rules: allow or block a domain

## Data Model

Each session stores:

- source
- URL, domain, path, and site section
- page title
- start, end, last-seen, and duration
- category and classifier confidence
- whether it was backfilled

Example:

```json
{
  "source": "chrome_extension",
  "domain": "youtube.com",
  "site_section": "watch",
  "title": "MatPat Five Nights Lore Explainer",
  "start_at": "2026-06-21T17:30:00.000Z",
  "end_at": "2026-06-21T19:00:10.000Z",
  "duration_seconds": 5410,
  "category": "fun",
  "confidence": 0.78
}
```

## Roadmap

### MVP Polish

- Test with the unpacked extension during normal browsing.
- Add a calendar-scale timeline and richer day/week drilldowns.
- Add more tests around API routes and importer formats.
- Add packaging/install scripts for less technical setup.

### Post-MVP: Google Account Connection

- Add optional OAuth only after the local tracker is useful.
- Sync Calendar context for explaining work/meeting blocks.
- Consider Drive/Gmail metadata only with explicit opt-in.
- Keep sensitive scopes out of the MVP.

### Post-MVP: Android And Phone Tracking

Phone activity needs its own collector because desktop Chrome extension APIs do not cover Android system/app usage.

Possible approaches:

- Android app using UsageStatsManager for app-level foreground time.
- Android Accessibility Service only if deeper page/app context is worth the extra sensitivity.
- Chrome/Google history backfill from Takeout for mobile browsing history.
- Optional manual import from Digital Wellbeing exports if available.
- Same local API/event model, with `source` values like `android_usage_stats` or `mobile_chrome_backfill`.

Phone tracking should remain opt-in, local-first where possible, and clearly separate app-level duration from page-level browser detail.

## Privacy Defaults

- Store data locally in SQLite.
- Ignore incognito/private browser tabs.
- Provide pause/resume in the extension popup.
- Treat Gmail, Drive, Calendar, phone, and OAuth data as later opt-in features.
