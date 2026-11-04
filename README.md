# Content Studio

A single-user, mobile-first creator workspace built with Next.js App Router, strict TypeScript, Tailwind 4, Radix/shadcn-style accessible dialogs, Lucide, Recharts, SWR, React Hook Form, Zod, and the official Google APIs client. No paid AI service or external database is used.

## Run locally

Requires Node 22.22+ and npm. Run `npm ci`, copy `.env.example` to `.env.local`, set `APP_PASSWORD` to at least 16 characters and `SESSION_SECRET` to a random secret of at least 32 characters, then run `npm run dev`. Open http://127.0.0.1:3000. Both private API access and mutations require the session cookie. No private content is rendered into the signed-out HTML shell.

For local demo review, unset GOOGLE_AUTH_MODE after copying the example. Set your own local password and session secret. Production OAuth mode fails closed when its credentials or storage are unavailable.

When GOOGLE_AUTH_MODE is unset, the clearly labeled demo workspace persists edits in the ignored `.demo-data.json` file. The sample content is fictional and never copied into Google Sheets. Demo persistence requires a writable disk and a single server process. Real Google data is never silently substituted with sample data after an integration failure.

## Google Sheets connection

Production uses direct server-side Google OAuth with offline access and S256 PKCE. Connect or reconnect in Settings, select the Google account with access to your tracker, approve, and select **Continue to app**. No token copying or redeployment is needed after reconnecting.

The callback URL is https://content-studio-xi-peach.vercel.app/api/google/callback. Google OAuth applications in Testing still require reauthorization after seven days. Production/publication status and Google's verification policies remain separate from token storage.

The private Blob store **content-studio-oauth-private** is dedicated to this project. Refresh credentials and pending PKCE attempts are AES-256-GCM encrypted with fresh 96-bit IVs. HKDF-SHA256 derives separate purpose keys from SESSION_SECRET, scoped to GOOGLE_CLIENT_ID and APP_ORIGIN. Keep SESSION_SECRET stable; rotating it requires reconnecting. Tokens never appear in HTML, JSON responses, cookies, logs, browser storage, spreadsheets, or Git.

Every credential read bypasses the Blob CDN using useCache:false. A fresh OAuth client is created for every data request, so an existing server instance never reuses an access token tied to a replaced refresh credential. Google access tokens refresh server-side. State claims use atomic create-only writes before code exchange and are never released after a failure. Credential replacement uses an ETag compare-and-swap captured when authorization began to prevent an older attempt replacing a newer reconnect.

Set VERCEL_BLOB_RETRIES=0. The app fails closed if this is not set, if storage is unavailable, or if decryption fails. Writes, claims, and uncertain code exchanges are not retried. An uncertain write requires a fresh connection attempt; the old attempt remains consumed. GOOGLE_REFRESH_TOKEN is a legacy migration fallback only when an uncached storage read confirms the credential object is absent. Do not add a token to this variable for normal reconnects.

Required production configuration: GOOGLE_AUTH_MODE=oauth, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_ORIGIN, BLOB_READ_WRITE_TOKEN, VERCEL_BLOB_RETRIES=0, APP_PASSWORD, SESSION_SECRET, and the existing spreadsheet ID/write setting. Google OAuth does not read or mutate the spreadsheet during authorization. Service-account keys and Vercel Connect are no longer used.

Encrypted pending attempts and state-claim objects are intentionally retained for replay protection. They contain no plaintext credentials. An operator can remove attempts and claims older than 24 hours after confirming their ten-minute validity window has elapsed; never remove active claims or the credential object as an automatic recovery step.

## Live schema inspection performed

On October 26, 2026, the connected Google Sheets API confirmed these tabs and required headers against the supplied brief:

| Worksheet           | Google sheet ID |                      Existing columns |
| ------------------- | --------------: | ------------------------------------: |
| Content Ideas       |       343712306 | 24 populated headers, 28 grid columns |
| Published Content   |       510387411 |                                    16 |
| Performance Tracker |      1931048475 |                                    21 |

The spreadsheet timezone was `Etc/GMT`. The app does not modify it. Application dates and display times use **Asia/Jakarta**. The inspection was read-only. No existing worksheet was modified, and authorization itself does not perform any spreadsheet write.

Every live read/write rechecks required tab names and headers. Column positions may change: mapping uses header text. Unexpected duplicate headers, missing headers, ambiguous IDs, or grids larger than 10,000 rows / 100 columns stop operations with an explicit error. Formula and effective-value reads are separate, so formulas remain protected while computed metrics can be displayed. Sheets numeric date/time serials are converted for display without changing untouched cells.

## Stable identifiers and sidecar migration

Existing idea rows lack IDs. Before any app writes:

- Read-only idea IDs are derived from a normalized full-row fingerprint, never from a row index.
- In the first atomic write batch, existing ideas are registered in `CS_Metadata` with an ID, row fingerprint, and an anchor based on discovery date + exact title. Existing sheets receive no ID column and are not restructured.
- Later reads find the same ID by fingerprint or unique anchor. Row reordering is supported. Changing an idea in the app preserves its ID and updates its anchor in the same atomic batch.
- Existing published videos retain their `Video ID`. Newly created records receive UUID-based IDs. App video links store the idea ID in the existing `Related Idea` column; old free-text links are displayed without guesses and can be linked explicitly from the editor.
- Idea archive flags, footage confirmation, deadlines, and supplemental YouTube publishing date/time live in metadata rather than new original-sheet columns. `CS_Schedule` stores separate platform-specific plans. `CS_Settings` is created only when preferences are saved.
- Exactly duplicated records or duplicate idea title/date anchors need manual disambiguation before writes. If an external edit changes both an idea's title and discovery date after registration, the app cannot reliably match it and blocks writes when the old metadata is orphaned. Reconcile the affected metadata with the current row; do not guess based on its current row number. Restore the prior title/date temporarily if necessary, then perform the intended rename in the app.

## Data integrity and concurrency

- Inputs are validated on both client and server. Ideas use soft archiving. Snapshot history is append-only: one observation per video/platform/Jakarta calendar date. A duplicate date is rejected, not overwritten. Multiple observations per day are outside this MVP.
- Existing metric columns are retained when editing publishing details. Only changed mapped cells are updated, with the `userEnteredValue` field mask; unknown columns, formulas, formatting, and historical records are retained. User strings are written as strings, not executable formulas.
- Mutations re-read current data and compare the editor's record version. Stale edits return HTTP 409. A shared `CS_Write_Lock` worksheet serializes app edits across serverless instances. Each save re-reads data after acquiring the lock and applies content, metadata, and lock deletion in one atomic `spreadsheets.batchUpdate`. Transport retries are explicitly disabled.
- Transient read failures retry with exponential backoff. Writes are never automatically retried, since a timeout can happen after a successful commit. After an uncertain write, refresh and inspect the latest state before manually resubmitting.
- **Sheets has no conditional row-write/compare-and-swap operation.** An external edit between the final read and write can still race. Run one app instance and avoid simultaneous external edits while saving. Fully transactional conflict prevention across multiple servers or simultaneous Google Sheets editors is not claimed.
- The MVP bounds reads; it does not page beyond the 10,000-row safe limit. For larger trackers, extend the repository with paged range reads.

## Features

- Overview dashboard, searchable/filterable ideas with scripts and copy controls, archive/restore and duplication.
- Desktop drag/drop pipeline and mobile stage selectors, with legacy raw statuses retained until explicitly changed.
- Month/week calendar with independent platform plans, rescheduling, cancelled plans, and actual publication records.
- One underlying video with optional Instagram, TikTok, and YouTube post details. At least one post URL is required. Missing dates stay missing.
- Manual nullable performance metrics and observation history. No social API scraping or automatic publishing.
- Date-filtered analytics, category sample counts, mean/median views, per-platform recorded views, observed view changes, direct post links, and sorting by available metrics.
- Active polling every 45 seconds, focus/reconnect revalidation, manual sync, and success/failure feedback.
- Dark/light theme, responsive navigation, installable manifest, and read-only device caching.

Engagement rate is recorded interactions / views × 100; if interactions are absent, likes + comments + shares + saves is used only when all four metrics are recorded. Zero views produce no rate. Overall rate is the arithmetic mean of complete video-platform observations. Date-filtered totals select the latest available observation per video/platform **inside** the selected date range. Observation charts sum only cumulative snapshots recorded on that date; they do not represent daily view gains or interpolate unrecorded days. Category comparisons pool video-platform observations and label small samples. Missing values display a dash, not zero.

## PWA and offline use

Use a production build served over HTTPS for installation on your phone. Desktop localhost also qualifies as a secure context. Android/desktop browsers offer Install in their menu; iOS Safari offers Share → Add to Home Screen. The manifest includes 192px and 512px icons, standalone display, and a service worker.

After a successful sign-in/sync, content is cached in this browser's local storage for offline reading. The service worker caches only the public app shell and static assets; API responses and credentials are never cached by it. Offline writes are disabled. A previously loaded screen can continue displaying data; offline cold launch depends on browser service-worker storage and previously cached scripts. Test installation and offline cold launch on your target phone after HTTPS deployment. Logout clears local private content. Use a trusted device; local offline content is not independently encrypted.

## Deployment

Run `npm run build`, then `npm start` for a production local server. The default start script binds loopback; for a reverse proxy use that port as upstream, or explicitly run `npx next start --hostname 0.0.0.0` in a protected hosting environment.

Deploy as a **single Node.js process** on a host supporting Next.js 16/Node 22 with HTTPS and environment secrets. Protect inbound traffic with your HTTPS reverse proxy and keep the original Host header for origin validation. Set a strong unique password and session secret; cookies are HttpOnly, SameSite=Strict, and Secure in production. Add the Google environment values in your host's secret manager. Do not use a static-only export for this app.

For a serverless **demo**, set `DEMO_STORAGE=browser`. The authenticated API validates mutations, and the browser persists sample data in local storage. Changes survive page refreshes in that browser, but do not synchronize across devices. The API never writes demo data to the deployment filesystem or Google Sheets in this mode. Clear site storage to reset it. Real Google Sheets mode ignores browser demo state.

Real-sheet writes use the unique hidden `CS_Write_Lock` tab as a shared mutex across serverless instances; no external database is required. A competing save receives HTTP 409 before reading editable data. The lock never expires automatically: after a crash or uncertain write, refresh and inspect the record before recovery. If the lock remains, stop all writers and wait for every potentially running function/request to finish before deleting only that lock tab. Never delete it during an active save. The commit includes deletion of its exact lock sheet ID, so a delayed old commit cannot succeed after that lock is removed. This coordinates this app only; direct Google Sheets edits or other apps do not participate, so avoid editing the same sheet directly while an app save is in progress. All data APIs require authentication; the UI initially shows only a signed-out shell. Sign-in is rate-limited per process. Never expose the temporary local password publicly.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Unit/integration tests use isolated temporary demo files and mock Google APIs; they require no Google credentials. Playwright runs against the local server, using the installed Microsoft Edge browser (`channel: msedge`). Set `E2E_PASSWORD` if you changed the workspace password. Install Edge or change the Playwright channel for another environment. End-to-end tests create demo records; run them against demo mode only. Tests refuse to mutate a live workspace.

## Platform versions and performance

One published content card contains separate Instagram, TikTok, and YouTube performance sections. Edit published post links to enter each platform version's actual duration. The idea's target duration remains a production planning value. Old shared durations are preserved and are not treated as actual durations for every platform. Missing values display as unknown.

Dashboard and Analytics follow the selected platform (remembered on the device), including views, engagement, observation charts, rankings, and category comparisons. Headline views use the latest observation for each video within the selected dates; they do not sum snapshots across history or platforms. Average watched percentage uses the actual duration of the same platform's version.

## Cancel an idea

Use **Cancel idea** in the Idea library, pipeline stage menu, or idea editor. A reason is required. Cancellation keeps the idea and its notes, records the reason, excludes it from active production, and cancels its pending schedules in the same coordinated save. **Restore idea** returns it to its previous stage without restarting old schedules. Original sheet columns are unchanged; cancellation details live in the existing metadata sidecar.

## Phase boundaries and known limitations

Phase 1 supplies the core daily workflow. Phase 2 covers the deterministic weekly recommendation engine, advanced retention/category comparisons, publishing consistency reports, and statistically supported time-slot recommendations. No invented trend scoring or recommendation placeholders run in Phase 1. Social API integrations and import/export reports remain Phase 3.

The production app is hosted at https://content-studio-xi-peach.vercel.app. On October 26, 2026, live Google Sheets reads were verified through the deployed app using direct Google OAuth: 40 ideas, 11 published videos, and 17 historical performance snapshots loaded, with no schema warnings. Real ideas were also confirmed in the rendered Idea Library. All real-sheet writes remain disabled; no sheet data was modified during verification. Real write verification and phone installation verification remain outstanding. Secrets are managed only through Vercel's protected environment variables.

### Shared save coordination deployment

The production save lock was deployed and passed 50 tests, lint, type checks, and a production build. Live verification read all 40 ideas, 11 videos, and 17 snapshots and confirmed preferences are enabled. Google rejected the lock acquisition with HTTP 403, so actual Google editing permission is not yet verified. This was an initial historical permission check. Current reconnects use automatic encrypted storage described above. The permission probe did not change content.
