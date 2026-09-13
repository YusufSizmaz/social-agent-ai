<div align="center">

# Social Agent AI

**Self-hosted, AI-powered social media automation platform**

Automate your entire social media workflow — from AI content generation to multi-platform publishing, performance analytics, and autonomous strategy optimization. All running on your own infrastructure.

[![CI](https://github.com/YusufSizmaz/social-agent-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/YusufSizmaz/social-agent-ai/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/YusufSizmaz/social-agent-ai?style=social)](https://github.com/YusufSizmaz/social-agent-ai/stargazers)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14+-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Google Gemini](https://img.shields.io/badge/Google_Gemini-2.5_Flash-4285F4?logo=google&logoColor=white)](https://ai.google.dev/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Features](#features) · [Quick Start](#quick-start) · [Documentation](#web-dashboard) · [API Reference](#rest-api-reference) · [Contributing](#contributing)

</div>

---

## Why Social Agent AI?

Managing social media across multiple platforms is time-consuming and repetitive. Social Agent AI solves this by giving you a **fully autonomous content pipeline** that you own and control:

- **AI generates your content** — Google Gemini creates platform-optimized posts with the right tone, length, and hashtags
- **Publishes everywhere at once** — Twitter, Instagram, YouTube, TikTok from a single dashboard
- **Learns and improves itself** — Weekly strategy optimizer analyzes what works and automatically adjusts your posting strategy
- **Runs on your servers** — No SaaS fees, no data sharing, no vendor lock-in. Your content, your infrastructure

Whether you're a solo content creator, a digital agency managing multiple brands, or a developer building automation tools — this platform gives you everything out of the box.

---

## Features

### Content Generation Pipeline

| Capability | Description |
| --- | --- |
| **AI Text Generation** | Google Gemini (default `gemini-2.5-flash`) with structured JSON output — prompts include the platform's length and hashtag limits, tone and language |
| **Image Generation** | Google Imagen 4 with Pexels stock photo fallback |
| **Text-to-Speech** | Edge TTS neural voices, picked automatically from the content language (tr, en, de, es, fr, it, pt, ar) |
| **Video Assembly** | Full video pipeline: prompt → script → TTS audio → AI image → FFmpeg (Ken Burns, burned-in subtitles, logo, background music) |
| **Safety Checks** | Every post is fitted to platform limits and checked for length, hashtag count and banned words before publishing |
| **Quality Gate** | Optional Gemini quality score — autonomous posts below `QUALITY_MIN_SCORE` are held for manual review |

### Multi-Platform Publishing

| Platform | Content Types | Rate Limit | Max Text |
| --- | --- | --- | --- |
| **Twitter** | Text, Image, Video | 25/hr, 300/day | 280 chars |
| **Instagram** | Image, Reel | 10/hr, 50/day | 2,200 chars |
| **YouTube** | Video, Short | 5/hr, 20/day | 5,000 chars |
| **TikTok** | Video | 10/hr, 50/day | 2,200 chars |

Each platform adapter handles API authentication, media uploads, rate limiting, and retry logic independently. Adapters are **auto-registered** based on which API credentials you provide — no configuration needed.

### Autonomous Automation

- **Cron-based scheduling** — each account gets its own posting schedule via cron expressions
- **Content mix control** — configure ratios for original posts, reposts, and replies (e.g. 80/15/5)
- **PostgreSQL job queue** — reliable background processing with `SELECT FOR UPDATE SKIP LOCKED` for concurrent-safe dequeuing, plus automatic recovery of jobs interrupted by a crash
- **Plugin system** — poll external data sources, transform content, and publish automatically
- **Smart retries** — transient failures (timeouts, rate limits, 5xx) retry with exponential backoff; permanent ones (bad credentials, rejected content) fail fast with a clear error

### Analytics & Self-Improvement

- **Automatic tracking** — fetches engagement metrics (likes, comments, shares, impressions, reach) every 6 hours
- **Daily reports** — WhatsApp summary at 23:00 with engagement totals, top posts, and per-account breakdown
- **Weekly optimization** — every Monday at 02:00, analyzes 7-day performance data and auto-tunes:
  - Posting tone (emotional, informative, urgent, hopeful, friendly)
  - Posting schedule (cron expression)
  - Hashtag strategy

### Web Dashboard

A modern, single-page dashboard with dark theme and sidebar navigation:

- **Dashboard** — Real-time stat cards, platform breakdown, account performance table, recent activity feed
- **Projects** — Create and manage multiple brands/projects with logo uploads and independent configs
- **Accounts** — Link social media accounts with platform credentials, assign roles (primary/secondary/backup), define content strategies
- **Posts** — Browse, filter, generate AI content with tone/type selection, review quality/safety scores and errors, edit, and publish directly
- **Twitter OAuth** — Built-in 3-legged authentication flow
- **Password protection** — HTTP Basic Auth for the dashboard and API via `DASHBOARD_PASSWORD`

> The dashboard UI is currently in Turkish. Translations are a great first contribution!

### Notifications

- **WhatsApp integration** via whatsapp-web.js
- Real-time alerts for: content generated, post published, post failed, daily summary reports

---

## Quick Start

### Prerequisites

| Requirement | Version | Notes |
| --- | --- | --- |
| Node.js | >= 20 | Runtime |
| PostgreSQL | >= 14 | Primary database |
| FFmpeg | Any | *Optional* — required for video pipeline |

### Installation

```bash
# Clone the repository
git clone https://github.com/YusufSizmaz/social-agent-ai.git
cd social-agent-ai

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials (see Configuration section)

# Set up database
createdb social_media_bot
npm run db:migrate

# Optional: demo project so you can explore without any social credentials
npm run db:seed

# Start development server (auto-reloads on changes)
npm run dev
```

The dashboard will be available at **http://localhost:3000**

> **Upgrading from 1.0?** If you created your database with `npm run db:push`, just run `npm run db:migrate` — existing schemas are detected and baselined automatically.

### Production Deployment

```bash
npm run build
npm start
```

---

## Docker

The easiest way to get started. Includes PostgreSQL, Chromium (for WhatsApp), and FFmpeg.

```bash
# Configure environment
cp .env.example .env
# Set at minimum: GEMINI_API_KEY and DASHBOARD_PASSWORD

# Start all services — migrations run automatically on startup
docker compose up -d
```

**What's included in the Docker setup:**

- Multi-stage build, running as a non-root user
- PostgreSQL 16 (Alpine) with health checks, bound to localhost only
- Automatic database migrations on startup
- Chromium for WhatsApp Web.js session
- FFmpeg and fonts for the video pipeline
- Persistent volumes for database, WhatsApp session, generated media and temp files
- Container health check (`/api/health`) and graceful shutdown

> Deploying on a server? Put the app behind HTTPS (Caddy, Nginx, Traefik) and see [SECURITY.md](SECURITY.md).

---

## Configuration

### Required

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `GEMINI_API_KEY` | Google Gemini API key — [get one free](https://aistudio.google.com/apikey) |

### Security

| Variable | Default | Description |
| --- | --- | --- |
| `DASHBOARD_PASSWORD` | — | Enables HTTP Basic Auth for the dashboard and API. **Set this before exposing the server to any network.** |
| `DASHBOARD_USERNAME` | `admin` | Basic Auth username |

### Platform Credentials

Add credentials for each platform you want to publish to. **Only configure what you need** — the system automatically enables platforms based on available credentials.

| Variable | Platform |
| --- | --- |
| `TWITTER_API_KEY`, `TWITTER_API_SECRET` | Twitter API v2 (app credentials) |
| `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET` | Twitter API v2 (user credentials) |
| `TWITTER_CALLBACK_URL` | OAuth2 callback URL (default: `http://localhost:3000/api/twitter/callback`) |
| `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Instagram Graph API |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` | YouTube Data API v3 |
| `TIKTOK_ACCESS_TOKEN` | TikTok Content Posting API |

### Optional

| Variable | Default | Description |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | — | Public URL of this server. Required for Instagram to fetch locally generated media |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Text model |
| `GEMINI_IMAGE_MODEL` | `imagen-4.0-generate-001` | Image model |
| `QUALITY_CHECK_ENABLED` | `false` | Score posts with Gemini before publishing (one extra API call per post) |
| `QUALITY_MIN_SCORE` | `60` | Autonomous posts scoring below this are held for review |
| `PEXELS_API_KEY` | — | Stock images for media pipeline — [get one free](https://www.pexels.com/api/) |
| `WHATSAPP_ADMIN_NUMBER` | — | WhatsApp number for admin notifications (e.g. `905xxxxxxxxx`) |
| `PLUGIN_DATABASE_URL` | — | External database for content source plugins |
| `RUN_MIGRATIONS` | `false` (`true` in Docker) | Apply database migrations on startup |
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | `development` / `production` / `test` |
| `LOG_LEVEL` | `info` | `error` / `warn` / `info` / `debug` |

---

## Architecture

### Project Structure

```
src/
├── index.ts                  # Entry point — registers adapters/plugins, starts engine
├── config/
│   ├── constants.ts          # Platform limits, rate limits, enums
│   ├── env.ts                # Zod environment validation
│   └── logger.ts             # Winston logger configuration
├── types/
│   └── index.ts              # TypeScript interfaces (PlatformAdapter, ProjectPlugin, etc.)
├── db/
│   ├── index.ts              # Drizzle ORM connection + migration runner
│   ├── migrate.ts            # `npm run db:migrate` entry point
│   └── schema/
│       └── index.ts          # 6 tables: projects, accounts, posts, postAnalytics, jobQueue, logs
├── core/
│   ├── engine.ts             # Main orchestrator — job processing, cron registration
│   ├── content-service.ts    # Text / video generation + quality gate
│   ├── queue.ts              # PostgreSQL job queue (SKIP LOCKED, backoff, stale job recovery)
│   ├── scheduler.ts          # node-cron wrapper
│   ├── account-scheduler.ts  # Syncs account strategies → cron jobs
│   ├── strategy-optimizer.ts # Weekly auto-optimization (tone, schedule, hashtags)
│   ├── content-mix.ts        # Original / repost / reply selection
│   ├── media.ts              # Resolve local, public and remote media
│   ├── rate-limiter.ts       # Per-platform rate limiting via p-queue
│   ├── retry.ts              # Exponential backoff with jitter
│   ├── errors.ts             # Retryable vs. permanent errors
│   └── safety-guard.ts       # Platform fitting + content safety validation
├── ai/
│   ├── prompt-builder.ts     # Adds platform limits, tone and language to prompts
│   ├── text-generator.ts     # Gemini structured text generation
│   ├── quality-checker.ts    # AI quality scoring
│   ├── image-generator.ts    # Imagen + Pexels fallback
│   ├── tts.ts                # Edge TTS text-to-speech
│   ├── video-generator.ts    # FFmpeg video assembly
│   └── video-orchestrator.ts # Full video pipeline orchestrator
├── platforms/
│   ├── base.ts               # Abstract base adapter (rate limiting + retry)
│   ├── twitter/              # Twitter API v2 + OAuth2 flow
│   ├── instagram/            # Instagram Graph API
│   ├── youtube/              # YouTube Data API v3
│   └── tiktok/               # TikTok Content Posting API
├── plugins/
│   └── catpet/               # Example plugin: animal adoption content
├── analytics/
│   ├── tracker.ts            # Fetch & store engagement metrics
│   └── reporter.ts           # Daily summary report generation
├── notifications/
│   └── whatsapp.ts           # WhatsApp Web.js integration
└── server/
    ├── index.ts              # Express app setup, health check
    ├── middleware.ts         # Basic auth, validation helpers, error handler
    ├── schemas.ts            # zod request schemas
    ├── routes/
    │   ├── dashboard.ts      # Analytics and stats endpoints
    │   ├── projects.ts       # Project CRUD + logo upload
    │   ├── accounts.ts       # Account CRUD with credential sanitization
    │   ├── posts.ts          # Post CRUD, AI generation, publishing
    │   └── twitter-auth.ts   # Twitter OAuth2 flow
    └── views/
        └── index.html        # Single-page dashboard application
```

### Database Schema

```
┌─────────────┐       ┌─────────────┐       ┌─────────────────┐
│  projects   │       │  accounts   │       │     posts       │
├─────────────┤       ├─────────────┤       ├─────────────────┤
│ id (UUID)   │◄──┐   │ id (UUID)   │◄──┐   │ id (UUID)       │
│ name        │   ├───│ projectId   │   ├───│ projectId       │
│ description │   │   │ platform    │   │   │ accountId       │
│ active      │   │   │ role        │   │   │ platform        │
│ config      │   │   │ username    │   │   │ contentType     │
│ createdAt   │   │   │ credentials │   │   │ text, hashtags  │
│ updatedAt   │   │   │ strategy    │   │   │ mediaUrls       │
└─────────────┘   │   │ active      │   │   │ status, tone    │
                  │   │ lastUsedAt  │   │   │ safetyScore     │
                  │   └─────────────┘   │   │ qualityScore    │
                  │                     │   │ platformPostId  │
                  │                     │   │ publishedAt     │
                  │                     │   └────────┬────────┘
                  │                     │            │
                  │   ┌─────────────┐   │   ┌────────┴────────┐
                  │   │  jobQueue   │   │   │ postAnalytics   │
                  │   ├─────────────┤   │   ├─────────────────┤
                  │   │ id (UUID)   │   │   │ id (UUID)       │
                  │   │ type        │   │   │ postId          │
                  │   │ status      │   │   │ likes, comments │
                  │   │ payload     │   │   │ shares, reach   │
                  │   │ priority    │   │   │ impressions     │
                  │   │ attempts    │   │   │ engagementRate  │
                  │   │ scheduledAt │   │   │ fetchedAt       │
                  │   └─────────────┘   │   └─────────────────┘
                  │                     │
                  │   ┌─────────────┐   │
                  │   │    logs     │   │
                  │   ├─────────────┤   │
                  │   │ id (UUID)   │   │
                  │   │ level       │   │
                  │   │ message     │   │
                  │   │ context     │   │
                  │   │ source      │   │
                  │   └─────────────┘   │
                  │                     │
                  └─────────────────────┘
```

### System Flow

```
                     ┌──────────────┐
                     │   Plugins    │ ← poll external sources (RSS, databases, APIs)
                     └──────┬───────┘
                            │ ContentRequest
                            ▼
┌──────────┐    ┌───────────────────────┐    ┌──────────────────┐
│ Scheduler│───▶│        Engine         │───▶│    AI Pipeline   │
│ (cron)   │    │                       │    │                  │
│          │    │  PostgreSQL Job Queue  │◀───│  Gemini (text)   │
│ per-     │    │  ┌─────────────────┐  │    │  Imagen (image)  │
│ account  │    │  │ SKIP LOCKED     │  │    │  Edge TTS        │
│ strategy │    │  │ dequeue → run   │  │    │  FFmpeg          │
└──────────┘    │  └─────────────────┘  │    └──────────────────┘
                └───────────┬───────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Twitter  │ │Instagram │ │ YouTube  │  + TikTok
        │ API v2   │ │ Graph API│ │ Data API │
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │             │             │
             └─────────────┼─────────────┘
                           ▼
              ┌────────────────────────┐
              │      Feedback Loop     │
              │                        │
              │  every 6h → Analytics  │ ← fetch engagement metrics
              │  daily    → Reporter   │ ← WhatsApp summary
              │  weekly   → Optimizer  │ ← auto-tune strategies
              └────────────────────────┘
```

### Video Generation Pipeline

```
User Prompt
    │
    ▼
┌─────────────┐    ┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│   Gemini    │───▶│  Edge TTS   │───▶│ Imagen/Pexels│───▶│   FFmpeg    │
│  (script)   │    │  (audio)    │    │   (image)    │    │  (assembly) │
└─────────────┘    └─────────────┘    └──────────────┘    └──────┬──────┘
                                                                 │
                                                                 ▼
                                                          Final .mp4 Video
```

### Scheduled Jobs

| Job | Schedule | What it does |
| --- | --- | --- |
| Plugin polling | Every 5 min | Checks plugins for new content requests |
| Analytics tracking | Every 6 hours | Fetches engagement metrics for all published posts |
| Daily report | 23:00 daily | Sends WhatsApp summary with engagement stats |
| Strategy optimization | Monday 02:00 | Analyzes 7-day data, auto-tunes tone/schedule/hashtags |
| Stale job recovery | Every 10 min | Re-queues jobs interrupted by a crash or restart |
| Account strategies | Per-account cron | Generates and publishes content per account config |

---

## REST API Reference

All endpoints except `/api/health` and the Twitter OAuth callback require Basic Auth when `DASHBOARD_PASSWORD` is set. Request bodies are validated; invalid input returns `400` with an `issues` array.

```bash
curl -u admin:$DASHBOARD_PASSWORD http://localhost:3000/api/posts?status=review
```

### Health

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Database connectivity and engine status (public) |

### Projects

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/projects` | List all projects with account and post counts |
| `POST` | `/api/projects` | Create a new project |
| `GET` | `/api/projects/:id` | Get project details |
| `PATCH` | `/api/projects/:id` | Update project |
| `POST` | `/api/projects/:id/logo` | Upload project logo (max 2MB — png, jpeg, webp) |
| `DELETE` | `/api/projects/:id` | Delete project (use `?force=true` for cascade) |

### Accounts

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/accounts?projectId=` | List accounts (credentials are sanitized in response) |
| `POST` | `/api/accounts` | Create account with platform credentials and strategy |
| `PATCH` | `/api/accounts/:id` | Update account settings, credentials, or strategy |
| `DELETE` | `/api/accounts/:id` | Delete account (use `?force=true` to also delete its posts) |

### Posts

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/posts` | List posts — filter by `projectId`, `platform`, `status`, `limit`, `offset` |
| `POST` | `/api/posts/generate` | Generate AI content (text, or the full video pipeline for `video`/`short`/`reel`) — saved with status `review` |
| `GET` | `/api/posts/:id` | Get post with latest analytics data |
| `POST` | `/api/posts/:id/publish` | Publish post to its target platform |
| `PATCH` | `/api/posts/:id` | Update post text, hashtags, or status |
| `DELETE` | `/api/posts/:id` | Delete post |

### Dashboard & Analytics

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/dashboard/stats` | Post counts, job queue status, active accounts |
| `GET` | `/api/dashboard/recent-posts` | Last 20 posts across all platforms |
| `GET` | `/api/dashboard/analytics-summary` | 7-day engagement totals, platform breakdown, daily trend |
| `GET` | `/api/dashboard/account-performance` | Per-account stats: post count, likes, engagement rate |

### Twitter Authentication

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/twitter/auth?accountId=` | Start OAuth flow (redirects to Twitter) |
| `GET` | `/api/twitter/callback` | OAuth callback — saves tokens to account |

> Dashboard and post list endpoints support an optional `?projectId=` query parameter for project-scoped filtering.

---

## Account Strategies

Each account can run autonomously with a JSON-defined content strategy:

```json
{
  "active": true,
  "tone": "emotional",
  "contentTypes": ["text", "image"],
  "promptTemplate": "Write a social media post about animal welfare",
  "cronExpression": "0 9,13,18 * * *",
  "contentMix": { "original": 80, "repost": 15, "reply": 5 },
  "hashtags": ["#adopt", "#rescue"],
  "language": "tr"
}
```

| Field | Type | Description |
| --- | --- | --- |
| `active` | boolean | Enable/disable automated posting for this account |
| `tone` | string | Content tone — `emotional`, `informative`, `urgent`, `hopeful`, `friendly` |
| `contentTypes` | string[] | Allowed types — `text`, `image`, `video`, `story`, `reel`, `short` |
| `promptTemplate` | string | Base prompt sent to Gemini for content generation (required when `active`) |
| `cronExpression` | string | Posting schedule in standard cron syntax (validated) |
| `contentMix` | object | Percentage split between original posts, reposts, and replies |
| `hashtags` | string[] | Default hashtags merged with AI-generated ones |
| `language` | string | Content language code (`tr`, `en`, etc.) — also selects the TTS voice |

Changes made in the dashboard take effect immediately — no restart needed.

The **strategy optimizer** runs every Monday at 02:00, analyzes the past 7 days of engagement data, and automatically adjusts `tone`, `cronExpression`, and `hashtags` to improve performance.

---

## Writing Plugins

Plugins let you feed content from any external source into the automation pipeline. Implement the `ProjectPlugin` interface:

```typescript
import type { ProjectPlugin, ContentRequest, GeneratedContent } from './types/index.js';

export class MyPlugin implements ProjectPlugin {
  name = 'my-plugin';

  async init(): Promise<void> {
    // Connect to your data source (database, API, RSS feed, etc.)
  }

  async poll(): Promise<ContentRequest[]> {
    // Called every 5 minutes — return new content requests.
    // `projectId` may be a project UUID or its name; an active account for the
    // platform is picked automatically (primary role first).
    return [];
  }

  transform(content: GeneratedContent): GeneratedContent {
    // Optionally modify AI-generated content before publishing
    return content;
  }

  getPrompt(request: ContentRequest): string {
    // Build the AI prompt when the request has no `prompt` of its own
    return 'Your prompt here...';
  }

  async destroy(): Promise<void> {
    // Clean up connections
  }
}
```

Register your plugin in `src/index.ts`:

```typescript
engine.registerPlugin(new MyPlugin());
```

The engine handles everything else — polling your plugin on schedule, generating content via AI, running safety checks, and publishing to all configured platforms.

> See [`src/plugins/catpet/`](src/plugins/catpet/) for a complete working example that polls an external database for animal adoption and lost pet listings.

---

## Tech Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| **Runtime** | Node.js 20+ | Server runtime |
| **Language** | TypeScript 5 (strict) | Type safety across the entire codebase |
| **Database** | PostgreSQL 14+ | Primary data store + job queue |
| **ORM** | Drizzle ORM | Type-safe database queries and schema management |
| **AI** | Google Gemini + Imagen | Text generation with structured JSON output, image generation |
| **Web** | Express.js | REST API and dashboard serving |
| **Job Queue** | PostgreSQL `SKIP LOCKED` | Concurrent-safe background job processing |
| **Scheduling** | node-cron | Cron-based task scheduling |
| **Media** | FFmpeg, Edge TTS, Google Imagen, Pexels | Video assembly, TTS, image generation |
| **Validation** | Zod | Runtime environment and input validation |
| **Logging** | Winston | Structured logging with multiple transports |
| **Notifications** | whatsapp-web.js | WhatsApp admin alerts and reports |
| **Testing** | Vitest + GitHub Actions | Unit tests, typecheck, migration and Docker checks on every PR |
| **Container** | Docker (multi-stage) | Production deployment |

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start development server with auto-reload (tsx watch) |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run the compiled production build |
| `npm run check` | Typecheck and run unit tests |
| `npm test` | Run unit tests (Vitest) |
| `npm run db:migrate` | Apply pending database migrations |
| `npm run db:generate` | Generate a migration after changing the schema |
| `npm run db:push` | Push schema directly (quick local prototyping only) |
| `npm run db:studio` | Open Drizzle Studio — visual database browser |
| `npm run db:seed` | Create a demo project, account and post |
| `npx tsx scripts/test-video.ts "<project>"` | Run the video pipeline for a project without publishing |

---

## Contributing

Contributions are welcome. Whether it's a new platform adapter, a plugin, a bug fix, a dashboard translation or documentation improvement — feel free to open a PR.

```bash
git clone https://github.com/<your-username>/social-agent-ai.git
cd social-agent-ai
npm install
cp .env.example .env          # DATABASE_URL and GEMINI_API_KEY at minimum
npm run db:migrate
npm run dev
```

Before opening a PR, run `npm run check`. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the project layout, how to add a platform adapter, and the PR checklist.

**Ideas for a first contribution:** English translation of the dashboard · LinkedIn / Bluesky / Threads adapters · RSS feed plugin · more unit tests.

---

## Responsible Use

Automating social media comes with responsibilities. Respect each platform's terms of service and automation rules, label AI-generated content where required, and don't use this project for spam, fake engagement or impersonation.

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
