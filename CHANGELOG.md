# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

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
