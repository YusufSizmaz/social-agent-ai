# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security
- Bumped `drizzle-orm` to 0.45 (SQL injection via improperly escaped identifiers) and `zod` to 4 (memory exhaustion on oversized collections); `npm audit fix` for critical `protobufjs` and `proxy-addr` advisories plus `multer`, `ws`, `axios`, `body-parser` and `form-data`.
- Dashboard HTML escaping now covers quotes, closing an attribute-injection XSS through project names, usernames and AI-generated hashtags.
- Password comparison no longer leaks the password length.
- Database errors no longer leak query parameters (e.g. account credentials) into logs, post error messages or WhatsApp notifications — drizzle 0.45 puts them in its error message.
- The Twitter OAuth flow can only be started for Twitter accounts (it used to overwrite any account's credentials).

### Added
- **Scheduled publishing** — approving a post takes an optional publish time; a once-a-minute scheduler publishes approved posts when they are due (approved posts previously stayed in `scheduled` forever).
- **Per-account hourly/daily publishing limits** are now enforced (they were documented but never applied); posts over the limit are postponed instead of failing.
- **Image and story posts get an image** (Imagen with Pexels fallback) — they used to be text-only, so Instagram image posts always failed.
- **WhatsApp pairing** — the QR code is printed in the log; previously the session could never be linked.
- `TZ` setting for cron schedules, the daily report and timestamps (Docker defaults to UTC).
- Failed posts can be retried from the dashboard; post edits are blocked while a post is publishing or published.

### Fixed
- **Docker never ran migrations** on a fresh install because `.env.example` set `RUN_MIGRATIONS=false`; compose now always migrates.
- **Instagram could not fetch generated media** when `DASHBOARD_PASSWORD` was set — `/public` is now served before Basic Auth.
- Instagram image containers are now awaited before publishing ("Media ID is not available"); insights use `views` instead of the removed `impressions` metric; Graph API v23.0.
- TikTok: checks the allowed privacy level (unaudited apps can only post privately), waits for processing and reports rejected uploads, stores the public post id, and sends `fields` as a query parameter so metrics work.
- Twitter media uploads use the v2 endpoint (v1.1 `media/upload` is retired).
- A failed metrics request no longer overwrites real numbers with zeros (Instagram, TikTok).
- Publishing is no longer retried inside the adapter: a timeout after the platform accepted a post could create a duplicate tweet/video. The job queue retries with a backoff instead.
- A single banned word now blocks a post (it took two before).
- Interrupted publish jobs no longer leave posts stuck in `publishing`; a job only publishes posts that are still `publishing`, so pulling a post back to review stops it.
- Strategy jobs re-check that the account, its strategy and its project are still active; deactivating a project now stops its accounts from posting.
- The weekly optimizer keeps the minutes and weekdays of a cron schedule and only changes the hours.
- Sibling accounts no longer reply to or repost each other's bot replies.
- Rate-limit (`429`) errors are retried after the platform's reset time instead of burning all attempts within two minutes.
- The engine retries startup when the database is not reachable yet, and stopped cron tasks no longer leak.
- Gemini: truncated (`MAX_TOKENS`) or blocked responses fail with a clear message instead of retrying; thinking is disabled only for Flash models (Pro models rejected the quality check).
- Background music no longer halves the voiceover volume; failed video renders no longer leave temp files behind.
- Dashboard: project defaults are applied in the Generate form, the project filter covers engagement stats, removing a logo is saved, 0% content-mix values are kept, the Active toggle is respected on create, and moving an account between projects is no longer offered (it was silently ignored).
- `/generate` no longer attaches a post to an account on another platform; empty account updates return 400; upload errors return 400/413 and duplicate names 409 instead of 500.
- Empty `PORT` / `QUALITY_MIN_SCORE` values fall back to their defaults instead of 0.
- Docker: WhatsApp cache directory is writable, larger `/dev/shm` for Chromium, graceful-shutdown period matches the engine's 60-second wait.

## [1.1.0] — 2026-09-13

### Added
- **Dashboard authentication** — HTTP Basic Auth via `DASHBOARD_PASSWORD` / `DASHBOARD_USERNAME`.
- **Request validation** for every API endpoint (zod), including cron expression validation for strategies.
- **Database migrations** — `npm run db:migrate`, optional auto-migration on startup (`RUN_MIGRATIONS`, on by default in Docker). Existing databases created with `db:push` are baselined automatically.
- **Quality gate** — optional Gemini quality scoring (`QUALITY_CHECK_ENABLED`, `QUALITY_MIN_SCORE`); low-scoring autonomous posts are held for review.
- **Instagram Reels** publishing with container status polling, and permalinks for published posts.
- **Multi-language content** — language setting per project/strategy drives the prompt and the TTS voice (tr, en, de, es, fr, it, pt, ar); `ttsVoice` override in project config.
- `PUBLIC_BASE_URL` so platforms that fetch media by URL can reach locally generated files.
- `GEMINI_MODEL` / `GEMINI_IMAGE_MODEL` settings.
- `/api/health` endpoint and Docker `HEALTHCHECK`.
- Stale job recovery for jobs left in `processing` after a crash, and exponential backoff between job retries.
- Database indexes for posts, analytics and the job queue.
- Unit test suite (Vitest), GitHub Actions CI (typecheck, tests, build, migrations, Docker), Dependabot.
- Demo seed script, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, issue and PR templates.
- Post detail view shows errors, quality/safety scores, analytics and the platform link.

### Fixed
- Account strategy crons **stopped running after the weekly optimizer** (or any resync) because re-registered jobs were never started.
- Account changes in the dashboard did not update cron schedules until restart; deleted/deactivated accounts kept posting.
- **Plugin pipeline was broken**: `getPrompt()`/`transform()` were never called and plugin project names were inserted as UUIDs.
- **Safety checks were never applied** before publishing; content is now fitted to platform limits and checked.
- Generated prompts ignored the selected tone and platform limits (e.g. 280 characters on Twitter).
- Video pipeline used a macOS-only font path, breaking subtitles/logo text in Docker and on Linux.
- Subtitle text could inject ASS override tags; temp file names could collide under concurrency.
- Twitter could not upload remote images or dashboard-generated media; TikTok could not read `/public/...` videos and was missing required chunk fields.
- Dashboard analytics summed every 6-hourly snapshot, inflating likes and impressions.
- Deleting projects, accounts or posts with analytics failed on foreign keys.
- Account API responses on create/update returned stored credentials.
- Several XSS vectors in the dashboard (project names, strategy fields, account data in `onclick`).
- Twitter OAuth callback used `postMessage(..., '*')` and embedded unescaped values in a script.
- Failed posts sent duplicate WhatsApp notifications and were notified on every retry.
- Permanent errors (invalid API key, missing credentials) were retried repeatedly.
- Overlapping queue polls when a job took longer than the poll interval.
- Double-clicking "publish" could queue the same post twice.
- `npm run db:seed` pointed to a git-ignored file; the migration journal was git-ignored.
- Empty values in `.env` / docker-compose (`FOO=`) failed URL validation.

### Changed
- Docker image runs as a non-root user; Postgres port is bound to localhost; compose reads settings from `.env`.
- `hack`/`crack` were removed from the banned-word list (they blocked common tech content); banned words now match at word starts.
- Development scripts moved from `src/` to `scripts/`.

## [1.0.0]

Initial public release.
