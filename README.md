# Procrastinating

Local-first attention tracking for answering questions like:

- What have I been doing today?
- What was I doing in the last hour?
- What did I spend time on this week or this year?
- Was that time mostly fun, functional, mixed, or unknown?
- What can be reconstructed from before the tracker was installed?

The project is currently a desktop, local-first MVP. A Chrome extension records active browser sessions, a local Node/SQLite service stores them, and a dashboard summarizes the data.

## Project Status

Current state: **MVP v0.1 is built and usable for desktop Chrome tracking.**

This is not the full dream system yet. It does not have Google OAuth, Android/phone tracking, or polished installation. It is ready for local testing, daily browser tracking, dashboard review, category correction, basic privacy controls, and first-pass Google Takeout imports.

The current GitHub state includes:

- local API and dashboard
- Chrome extension
- SQLite storage
- fun/functional/mixed/unknown classification
- correction controls
- export/delete controls
- tracking privacy controls
- Google Takeout importer scaffold
- demo data script
- verification tests

## What Works Now

- Tracks active desktop Chrome tabs through the unpacked extension.
- Records URL, title, domain, path/site section, start time, end time, and active duration.
- Ends sessions when Chrome loses focus or the user goes idle.
- Merges brief same-URL interruptions without counting away-time as active time.
- Stores all data locally in `data/attention.sqlite`.
- Summarizes activity for today, last hour, this week, this year, and custom "since" ranges.
- Classifies sessions as `functional`, `fun`, `mixed`, or `unknown`.
- Lets you correct a single session or apply a correction to an entire domain.
- Lets you export JSON for the current dashboard range.
- Lets you delete one session, a full range, or a domain within the current range.
- Lets you block domains or switch to allowlist-only tracking.
- Shows the local-only privacy posture in the dashboard.
- Supports extension pause/resume, 15-minute pause, and 1-hour pause.
- Warns in the extension popup when the local API is offline.
- Has a first-pass Google Takeout/Chrome history importer for pre-install history.
- Includes tests and synthetic Takeout fixtures.

## Known Limits

- It has only been verified with synthetic/local checks, not a full real browsing day.
- The Takeout importer handles common JSON shapes, but real Google exports may need format-specific fixes.
- Backfilled history usually has timestamps, not reliable active duration.
- Desktop Chrome is the only live tracker right now.
- Android/phone tracking is planned but not implemented.
- Google OAuth/account connection is planned but not implemented.
- Calendar, Gmail, Drive, and richer context are not connected yet.
- There is no packaged installer; setup is still developer-style.
- Local git history may show divergence because earlier GitHub publishing happened through connector commits, but the file tree on GitHub matches the local project state.

## Quick Start

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

## Project Map

- `apps/api/`: local Node HTTP API and SQLite persistence.
- `apps/dashboard/`: browser dashboard served by the local API.
- `extension/`: unpacked Chrome extension.
- `tools/import-takeout.js`: Google Takeout/history importer.
- `tools/seed-demo.js`: demo data seeder.
- `tools/verify.js`: verification checks.
- `tests/fixtures/takeout/`: synthetic importer fixtures.
- `data/`: local SQLite database location; ignored by git.

## Next Work

Best next no-account-required work:

- Test the unpacked extension during a normal browsing day.
- Add a calendar-scale timeline and richer day/week drilldowns.
- Add more tests around API routes and importer formats.
- Add a simple install/start script.
- Add local database backup/restore controls.
- Add more privacy controls, such as delete by domain globally and optional encrypted storage.

Google account work:

- Add OAuth only after the local tracker feels useful.
- Start with Calendar context for explaining work/meeting blocks.
- Add Drive/Gmail metadata only with explicit opt-in.
- Keep sensitive scopes out of the MVP until there is a clear reason.

Android/phone work:

- Build a separate Android collector; desktop Chrome extension APIs do not cover phone activity.
- Likely first approach: Android `UsageStatsManager` for app-level foreground time.
- Possible deeper approach: Android Accessibility Service, but only if page/app context is worth the extra sensitivity.
- Import mobile Chrome/Google history through Takeout as a partial backfill.
- Reuse the same local API/event model with sources like `android_usage_stats` or `mobile_chrome_backfill`.

## Resume Checklist

When picking this project back up:

1. Run `npm test`.
2. Run `npm run dev`.
3. Open `http://localhost:3847`.
4. Load or reload the unpacked Chrome extension from `extension/`.
5. Browse normally for at least an hour.
6. Check whether sessions, idle behavior, categories, and domain rules feel correct.
7. Export JSON from the dashboard and inspect the shape before changing the data model.
8. If testing backfill, run `npm run import:takeout -- /path/to/Takeout` on a copied/exported Takeout folder.

## Privacy Defaults

- Store data locally in SQLite.
- Ignore incognito/private browser tabs.
- Provide pause/resume in the extension popup.
- Support blocked domains and allowlist-only tracking.
- Treat Gmail, Drive, Calendar, phone, and OAuth data as later opt-in features.
