# Contributing to Social Agent AI

Thanks for your interest in improving Social Agent AI! Bug fixes, new platform adapters, plugins, docs and translations are all welcome.

## Getting started

```bash
git clone https://github.com/<your-username>/social-agent-ai.git
cd social-agent-ai
npm install
cp .env.example .env          # set DATABASE_URL and GEMINI_API_KEY at minimum

# Start a local Postgres if you don't have one
docker compose up -d db       # then DATABASE_URL=postgresql://bot:bot@localhost:5432/social_media_bot

npm run db:migrate
npm run db:seed               # optional demo data
npm run dev                   # http://localhost:3000
```

## Before opening a pull request

```bash
npm run check                 # typecheck + unit tests
```

- **Keep PRs focused.** One feature or fix per PR is much easier to review.
- **Add tests** for pure logic (see `tests/`). Unit tests must not call external APIs or the database.
- **Schema changes** need a migration: edit `src/db/schema/index.ts`, then run `npm run db:generate` and commit the generated files in `drizzle/`. CI fails if the schema and migrations drift apart.
- **New environment variables** go in `src/config/env.ts`, `.env.example` and the README configuration tables.
- **Never commit secrets.** Double-check logs and screenshots for tokens.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).

## Project layout

| Path | What lives there |
| --- | --- |
| `src/core/` | Engine, job queue, scheduler, safety checks, content pipeline |
| `src/ai/` | Gemini text/quality, Imagen, TTS, FFmpeg video assembly |
| `src/platforms/` | One adapter per social network |
| `src/plugins/` | Content sources that feed the engine |
| `src/server/` | Express API, validation schemas and the dashboard |
| `drizzle/` | SQL migrations |
| `scripts/` | Developer utilities (seed, model listing, video pipeline test) |
| `tests/` | Vitest unit tests |

## Adding a platform adapter

1. Create `src/platforms/<name>/index.ts` extending `BasePlatformAdapter` — you get rate limiting and retries for free.
2. Implement `doPost`, `doDelete` and `doGetAnalytics`; optionally `reply`, `repost` and `invalidateAccount`.
3. Use `resolveMediaFile()` / `toAbsoluteUrl()` from `src/core/media.ts` for media, and `composePostText()` for captions.
4. Throw `NonRetryableError` for failures that won't fix themselves (missing credentials, rejected content).
5. Add the platform to the enums in `src/config/constants.ts` and `src/db/schema/index.ts` (with a migration), then register it in `src/index.ts`.

## Writing a plugin

See [Writing Plugins](README.md#writing-plugins) in the README and the example in `src/plugins/catpet/`.

## Reporting bugs and security issues

- Bugs and feature ideas: [open an issue](https://github.com/YusufSizmaz/social-agent-ai/issues/new/choose).
- Security vulnerabilities: please follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
