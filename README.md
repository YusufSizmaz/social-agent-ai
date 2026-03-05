<div align="center">

# Social Agent AI

**Self-hosted, AI-powered social media automation platform**

Automate your entire social media workflow — from AI content generation to multi-platform publishing, performance analytics, and autonomous strategy optimization. All running on your own infrastructure.

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
| **AI Text Generation** | Google Gemini 2.5 Flash with structured JSON output — generates platform-aware text, hashtags, and metadata |
| **Image Generation** | AI-powered images via Pollinations.ai with Pexels stock photo fallback |
| **Text-to-Speech** | Edge TTS engine for natural-sounding voiceovers |
| **Video Assembly** | Full video pipeline: prompt → text → TTS audio → AI image → FFmpeg video assembly |
| **Safety Checks** | Automated content validation — length limits, banned word filtering, quality scoring (min score: 60) |
| **Quality Scoring** | AI-based quality assessment before publishing |

### Multi-Platform Publishing

| Platform | Content Types | Rate Limit | Max Text |
| --- | --- | --- | --- |
| **Twitter** | Text, Image, Video | 25/hr, 300/day | 280 chars |
| **Instagram** | Image, Story, Reel | 10/hr, 50/day | 2,200 chars |
| **YouTube** | Video, Short | 5/hr, 20/day | 5,000 chars |
| **TikTok** | Video | 10/hr, 50/day | 2,200 chars |

Each platform adapter handles API authentication, media uploads, rate limiting, and retry logic independently. Adapters are **auto-registered** based on which API credentials you provide — no configuration needed.

### Autonomous Automation

- **Cron-based scheduling** — each account gets its own posting schedule via cron expressions
- **Content mix control** — configure ratios for original posts, reposts, and replies (e.g. 80/15/5)
- **PostgreSQL job queue** — reliable background processing with `SELECT FOR UPDATE SKIP LOCKED` for concurrent-safe dequeuing
- **Plugin system** — poll external data sources, transform content, and publish automatically
- **Exponential backoff** — failed jobs retry with jitter (max 3 retries, up to 30s delay)

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
- **Posts** — Browse, filter, generate AI content with tone/type selection, edit, and publish directly
- **Twitter OAuth2** — Built-in authentication flow via popup

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
npm run db:push

# Start development server
npm run dev
```

The dashboard will be available at **http://localhost:3000**

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
# Set at minimum: GEMINI_API_KEY

# Start all services
docker compose up -d

# Push database schema
DATABASE_URL=postgresql://bot:bot@localhost:5432/social_media_bot npm run db:push
```

**What's included in the Docker setup:**

- Multi-stage build for minimal image size
- PostgreSQL 16 (Alpine) with health checks
- Chromium for WhatsApp Web.js session
- FFmpeg for video pipeline
- Persistent volumes for database, WhatsApp session, and temp files
- Graceful shutdown handling

---

## Configuration

### Required

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `GEMINI_API_KEY` | Google Gemini API key — [get one free](https://aistudio.google.com/apikey) |

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
| `PEXELS_API_KEY` | — | Stock images for media pipeline — [get one free](https://www.pexels.com/api/) |
| `WHATSAPP_ADMIN_NUMBER` | — | WhatsApp number for admin notifications (e.g. `905xxxxxxxxx`) |
| `PLUGIN_DATABASE_URL` | — | External database for content source plugins |
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
│   ├── index.ts              # Drizzle ORM connection
│   ├── seed.ts               # Database seeding
│   └── schema/
│       └── index.ts          # 6 tables: projects, accounts, posts, postAnalytics, jobQueue, logs
├── core/
│   ├── engine.ts             # Main orchestrator — job processing, cron registration
│   ├── queue.ts              # PostgreSQL job queue (SKIP LOCKED)
│   ├── scheduler.ts          # node-cron wrapper
│   ├── account-scheduler.ts  # Syncs account strategies → cron jobs
│   ├── strategy-optimizer.ts # Weekly auto-optimization (tone, schedule, hashtags)
│   ├── rate-limiter.ts       # Per-platform rate limiting via p-queue
│   ├── retry.ts              # Exponential backoff with jitter
│   └── safety-guard.ts       # Content safety validation
├── ai/
│   ├── text-generator.ts     # Gemini structured text generation
│   ├── quality-checker.ts    # AI quality scoring
│   ├── image-generator.ts    # Pollinations.ai + Pexels fallback
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
    ├── index.ts              # Express app setup and middleware
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
│ per-     │    │  ┌─────────────────┐  │    │  Pollinations    │
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
│   Gemini    │───▶│  Edge TTS   │───▶│ Pollinations │───▶│   FFmpeg    │
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
| Account strategies | Per-account cron | Generates and publishes content per account config |

---

## REST API Reference

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
| `DELETE` | `/api/accounts/:id` | Delete account |

### Posts

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/posts` | List posts — filter by `projectId`, `platform`, `status`, `limit`, `offset` |
| `POST` | `/api/posts/generate` | Generate AI content (text, image, or full video pipeline) |
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
| `GET` | `/api/twitter/auth?accountId=` | Start OAuth2 flow (redirects to Twitter) |
| `GET` | `/api/twitter/callback` | OAuth2 callback — saves tokens to account |

> All list endpoints support optional `?projectId=` query parameter for project-scoped filtering.

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
| `promptTemplate` | string | Base prompt sent to Gemini for content generation |
| `cronExpression` | string | Posting schedule in standard cron syntax |
| `contentMix` | object | Percentage split between original posts, reposts, and replies |
| `hashtags` | string[] | Default hashtags merged with AI-generated ones |
| `language` | string | Content language code (`tr`, `en`, etc.) |

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
    // Called every 5 minutes — return new content requests
    return [];
  }

  transform(content: GeneratedContent): GeneratedContent {
    // Optionally modify AI-generated content before publishing
    return content;
  }

  getPrompt(request: ContentRequest): string {
    // Build the AI prompt for this specific content request
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
| **AI** | Google Gemini 2.5 Flash | Text generation with structured JSON output |
| **Web** | Express.js | REST API and dashboard serving |
| **Job Queue** | PostgreSQL `SKIP LOCKED` | Concurrent-safe background job processing |
| **Scheduling** | node-cron | Cron-based task scheduling |
| **Media** | FFmpeg, Edge TTS, Pollinations.ai, Pexels | Video assembly, TTS, image generation |
| **Validation** | Zod | Runtime environment and input validation |
| **Logging** | Winston | Structured logging with multiple transports |
| **Notifications** | whatsapp-web.js | WhatsApp admin alerts and reports |
| **Container** | Docker (multi-stage) | Production deployment |

---

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start development server with hot reload (tsx) |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run the compiled production build |
| `npm run db:push` | Push schema changes to database |
| `npm run db:generate` | Generate Drizzle migration files |
| `npm run db:studio` | Open Drizzle Studio — visual database browser |
| `npm run db:seed` | Seed database with sample data |

---

## Contributing

Contributions are welcome. Whether it's a new platform adapter, a plugin, a bug fix, or documentation improvement — feel free to open a PR.

```bash
# Fork and clone
git clone https://github.com/<your-username>/social-agent-ai.git
cd social-agent-ai

# Install and configure
npm install
cp .env.example .env
# Set DATABASE_URL and GEMINI_API_KEY at minimum

# Set up database and start developing
npm run db:push
npm run dev
```

1. Fork the repository
2. Create your feature branch — `git checkout -b feature/your-feature`
3. Commit your changes — `git commit -m 'Add your feature'`
4. Push to the branch — `git push origin feature/your-feature`
5. Open a Pull Request

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
