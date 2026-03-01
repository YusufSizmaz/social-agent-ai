# Social Agent AI

Open-source, self-hosted social media automation platform with AI-powered content generation, multi-platform publishing, analytics tracking, and autonomous strategy optimization.

Built with TypeScript. Designed for agencies, content creators, and developers who want full control over their social media pipeline.

> Originally built for Turkish content, but fully adaptable to any language through prompt configuration.

## Features

**Content Pipeline**
- AI-powered content generation via Google Gemini with structured JSON output
- Multi-platform publishing — Twitter, Instagram, YouTube, TikTok
- Content safety checks — length validation, banned word filtering, quality scoring
- Media pipeline — AI image generation, text-to-speech, FFmpeg video assembly

**Automation**
- Cron-based scheduling per account with customizable strategies
- PostgreSQL job queue with `SELECT FOR UPDATE SKIP LOCKED` for reliable processing
- Plugin architecture — poll external data sources, transform, and publish automatically
- Per-platform, per-account rate limiting

**Analytics & Self-Improvement**
- Automatic analytics collection every 6 hours for all published posts
- Daily summary reports via WhatsApp (engagement metrics, top posts, per-account breakdown)
- Weekly strategy optimizer — analyzes performance data and auto-tunes posting tone, schedule, and hashtags

**Management**
- Web dashboard with dark theme — projects, accounts, posts, analytics at a glance
- REST API for all operations
- Multi-project support with independent configs and accounts
- WhatsApp admin notifications for publish events, failures, and reports

## Quick Start

### Prerequisites

- Node.js >= 20
- PostgreSQL >= 14
- FFmpeg (optional — for video pipeline)

### Installation

```bash
git clone https://github.com/YusufSizmaz/social-agent-ai.git
cd social-agent-ai

npm install

cp .env.example .env
# Edit .env with your credentials

createdb social_media_bot
npm run db:push

npm run dev
```

Dashboard: `http://localhost:3000`

### Docker

```bash
cp .env.example .env
# Edit .env — at minimum set GEMINI_API_KEY

docker compose up -d

# Push schema to database
docker compose exec app node -e "
  import('drizzle-kit').then(m => m.push({
    schema: './dist/db/schema/index.js',
    dialect: 'postgresql',
    dbCredentials: { url: process.env.DATABASE_URL }
  }))
"
```

Or push schema from host:

```bash
DATABASE_URL=postgresql://bot:bot@localhost:5432/social_media_bot npm run db:push
```

### Production

```bash
npm run build
npm start
```

## Configuration

### Required

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `GEMINI_API_KEY` | Google Gemini API key ([free](https://aistudio.google.com/apikey)) |

### Platform Credentials (optional — enable per platform)

| Variable | Platform |
| --- | --- |
| `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET` | Twitter API v2 |
| `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Instagram Graph API |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` | YouTube Data API |
| `TIKTOK_ACCESS_TOKEN` | TikTok |

### Other (optional)

| Variable | Description |
| --- | --- |
| `PEXELS_API_KEY` | Stock images ([free](https://www.pexels.com/api/)) |
| `WHATSAPP_ADMIN_NUMBER` | WhatsApp number for admin notifications (e.g. `905xxxxxxxxx`) |
| `CATPET_DATABASE_URL` | External DB for Catpet plugin |
| `PORT` | Server port (default: `3000`) |
| `NODE_ENV` | `development` / `production` / `test` |
| `LOG_LEVEL` | `error` / `warn` / `info` / `debug` |

Adapters are registered automatically based on which credentials are present. No Twitter keys = no Twitter adapter. The system runs with whatever platforms you configure.

## Architecture

```
src/
├── index.ts              # Entry point — registers adapters/plugins, starts engine
├── config/               # Constants, env validation (Zod), Winston logger
├── types/                # TypeScript interfaces
├── db/                   # Drizzle ORM — PostgreSQL schema + connection
│   └── schema/           # Tables: projects, accounts, posts, postAnalytics, jobQueue, logs
├── core/                 # Engine & infrastructure
│   ├── engine.ts         # Main orchestrator — job processing, cron registration
│   ├── queue.ts          # PostgreSQL job queue (SKIP LOCKED)
│   ├── scheduler.ts      # node-cron wrapper
│   ├── account-scheduler.ts  # Syncs account strategies → cron jobs
│   ├── strategy-optimizer.ts # Weekly auto-optimization (tone, schedule, hashtags)
│   ├── rate-limiter.ts   # Per-platform rate limiting (p-queue)
│   ├── retry.ts          # Exponential backoff with jitter
│   └── safety-guard.ts   # Content safety checks
├── ai/                   # AI pipeline
│   ├── text-generator.ts     # Gemini structured text generation
│   ├── quality-checker.ts    # AI quality scoring
│   ├── image-generator.ts    # Image generation (Pollinations.ai + Pexels fallback)
│   ├── tts.ts                # Text-to-speech (Edge TTS)
│   └── video-generator.ts    # FFmpeg video assembly
├── platforms/            # Platform adapters (implement PlatformAdapter interface)
│   ├── base.ts           # Abstract base with rate limiting & retry
│   ├── twitter/          # Twitter API v2
│   ├── instagram/        # Instagram Graph API
│   ├── youtube/          # YouTube Data API v3
│   └── tiktok/           # TikTok Content Posting API
├── plugins/              # Content source plugins (implement ProjectPlugin interface)
│   └── catpet/           # Example: animal adoption/lost pet content
├── analytics/            # Post performance tracking & reporting
│   ├── tracker.ts        # Fetch & store metrics for published posts
│   └── reporter.ts       # Generate reports with per-account breakdowns
├── notifications/        # WhatsApp admin notifications
└── server/               # Express web server
    ├── routes/           # REST API (projects, accounts, posts, dashboard)
    └── views/            # Single-page dashboard (vanilla HTML/CSS/JS)
```

### How It Works

```
                     ┌──────────────┐
                     │   Plugins    │ ← poll external sources (catpet, RSS, etc.)
                     └──────┬───────┘
                            │ ContentRequest
                            ▼
┌──────────┐    ┌───────────────────────┐    ┌──────────────┐
│ Scheduler│───▶│        Engine         │───▶│   AI (Gemini)│
│ (cron)   │    │  Job Queue → Process  │◀───│  text/image  │
└──────────┘    └───────────┬───────────┘    └──────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Twitter  │ │Instagram │ │ YouTube  │ ...
        └──────────┘ └──────────┘ └──────────┘
              │             │             │
              └─────────────┼─────────────┘
                            ▼
                   ┌────────────────┐
                   │   Analytics    │ ← every 6h: fetch metrics, store in DB
                   │   Optimizer    │ ← weekly: analyze & update strategies
                   │   Reporter     │ ← daily 23:00: WhatsApp summary
                   └────────────────┘
```

### Cron Jobs

| Name | Schedule | Description |
| --- | --- | --- |
| `poll-plugins` | Every 5 min | Poll plugins for new content requests |
| `track-analytics` | Every 6 hours | Fetch metrics for all published posts |
| `daily-report` | 23:00 daily | Send daily summary via WhatsApp |
| `optimize-strategies` | Monday 02:00 | Analyze 7-day data, auto-tune strategies |
| `account-strategy-*` | Per account | Content generation per account strategy cron |

## Web Dashboard

The built-in dashboard at `/` provides:

- **Dashboard** — Stat cards (posts, engagement, impressions), platform breakdown with metrics, account performance table, recent activity
- **Projects** — Create/manage projects with per-project settings
- **Accounts** — Link social media accounts with platform credentials, role assignment, and content strategies
- **Posts** — Browse, filter, delete posts. Generate new AI content with live preview

## REST API

### Projects

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/projects` | List all projects (with account/post counts) |
| `POST` | `/api/projects` | Create project |
| `GET` | `/api/projects/:id` | Get project details |
| `PATCH` | `/api/projects/:id` | Update project |
| `DELETE` | `/api/projects/:id` | Delete project |

### Accounts

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/accounts?projectId=` | List accounts |
| `POST` | `/api/accounts` | Create account with credentials + strategy |
| `PATCH` | `/api/accounts/:id` | Update account |
| `DELETE` | `/api/accounts/:id` | Delete account |

### Posts

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/posts?projectId=&platform=&status=` | List posts with filters |
| `POST` | `/api/posts/generate` | Generate AI content and save as draft |
| `GET` | `/api/posts/:id` | Get post with latest analytics |
| `DELETE` | `/api/posts/:id` | Delete post |

### Dashboard

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/dashboard/stats?projectId=` | Post and job statistics |
| `GET` | `/api/dashboard/recent-posts?projectId=` | Last 20 posts |
| `GET` | `/api/dashboard/analytics-summary` | 7-day engagement totals, platform breakdown, daily trend |
| `GET` | `/api/dashboard/account-performance` | Per-account stats (posts, likes, avg engagement, strategy status) |

## Account Strategies

Each account can have an automated content strategy defined as JSON:

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

The strategy optimizer runs weekly and adjusts `tone`, `cronExpression`, and `hashtags` based on actual engagement data.

## Writing Plugins

Plugins provide content from external sources. Implement the `ProjectPlugin` interface:

```typescript
import type { ProjectPlugin, ContentRequest, GeneratedContent } from './types/index.js';

export class MyPlugin implements ProjectPlugin {
  name = 'my-plugin';

  async init(): Promise<void> {
    // Connect to your data source
  }

  async poll(): Promise<ContentRequest[]> {
    // Return new content requests
    return [];
  }

  transform(content: GeneratedContent): GeneratedContent {
    // Optionally modify AI-generated content before publishing
    return content;
  }

  getPrompt(request: ContentRequest): string {
    // Build the AI prompt for this content request
    return 'Your prompt here...';
  }

  async destroy(): Promise<void> {
    // Clean up
  }
}
```

Register in `src/index.ts`:

```typescript
engine.registerPlugin(new MyPlugin());
```

The engine will automatically poll your plugin, generate content via AI, and publish to configured platforms.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js 20+ |
| Language | TypeScript 5 (strict mode) |
| Database | PostgreSQL 14+ / Drizzle ORM |
| AI | Google Gemini 2.5 Flash |
| Web | Express.js |
| Job Queue | PostgreSQL-native (`SKIP LOCKED`) |
| Scheduling | node-cron |
| Media | FFmpeg, Edge TTS, Pollinations.ai, Pexels |
| Validation | Zod |
| Logging | Winston |
| Notifications | whatsapp-web.js |

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start development server (tsx) |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled output |
| `npm run db:push` | Push schema to database |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run db:studio` | Open Drizzle Studio (visual DB browser) |

## Contributing

Contributions are welcome. Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Setup

```bash
git clone https://github.com/<your-fork>/social-media-bot.git
cd social-agent-ai
npm install
cp .env.example .env
# Set DATABASE_URL and GEMINI_API_KEY at minimum
npm run db:push
npm run dev
```

## License

MIT — see [LICENSE](LICENSE) for details.
