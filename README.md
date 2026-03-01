# Social Media Bot

Open-source, modular social media automation platform with AI-powered content generation. Built with TypeScript, designed for multi-project and multi-platform management.

> **Note:** Originally built for Turkish content creators, but fully adaptable to any language through prompt configuration.

## Features

- **Multi-platform** — Twitter, Instagram, YouTube, TikTok from a single dashboard
- **AI content generation** — Google Gemini-powered text generation with structured JSON output and quality scoring
- **Project management** — Manage multiple brands/products with independent configs, accounts, and content pipelines
- **Web dashboard** — Dark-themed management panel with project, account, post management and AI content generation
- **Plugin architecture** — Extensible content source system (poll external sources, transform, publish)
- **Job queue** — PostgreSQL-based async job queue with `SELECT FOR UPDATE SKIP LOCKED`
- **Rate limiting** — Per-platform, per-account rate limiting via p-queue
- **Content safety** — Length validation, banned word filtering, AI quality scoring
- **Notifications** — WhatsApp admin notifications
- **Analytics** — Post performance tracking and reporting
- **Zero vendor lock-in** — Self-hosted, uses free-tier APIs where possible

## Quick Start

### Prerequisites

- Node.js >= 20
- PostgreSQL >= 14
- FFmpeg (optional, for video pipeline)

### Installation

```bash
# Clone the repository
git clone https://github.com/yusufsizmaz/social-media-bot.git
cd social-media-bot

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Create database
createdb social_media_bot

# Push schema to database
npm run db:push

# Start development server
npm run dev
```

The web dashboard will be available at `http://localhost:3000`.

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
| `GEMINI_API_KEY` | Google Gemini API key ([get one free](https://aistudio.google.com/apikey)) |

### Optional (per platform)

| Variable | Description |
| --- | --- |
| `TWITTER_API_KEY` | Twitter API key |
| `TWITTER_API_SECRET` | Twitter API secret |
| `TWITTER_ACCESS_TOKEN` | Twitter access token |
| `TWITTER_ACCESS_SECRET` | Twitter access secret |
| `INSTAGRAM_ACCESS_TOKEN` | Instagram Graph API token |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Instagram business account ID |
| `YOUTUBE_CLIENT_ID` | YouTube OAuth client ID |
| `YOUTUBE_CLIENT_SECRET` | YouTube OAuth client secret |
| `YOUTUBE_REFRESH_TOKEN` | YouTube OAuth refresh token |
| `TIKTOK_ACCESS_TOKEN` | TikTok API token |
| `PEXELS_API_KEY` | Pexels stock image API key ([free](https://www.pexels.com/api/)) |
| `WHATSAPP_ADMIN_NUMBER` | WhatsApp admin number |
| `PORT` | Server port (default: 3000) |
| `NODE_ENV` | `development` \| `production` \| `test` |
| `LOG_LEVEL` | `error` \| `warn` \| `info` \| `debug` |

## Architecture

```
src/
├── config/          # Constants, env validation (Zod), Winston logger
├── types/           # TypeScript interfaces
├── db/              # Drizzle ORM schema + PostgreSQL connection
│   └── schema/      # pgEnum-based table definitions
├── core/            # Infrastructure
│   ├── engine.ts    # Main orchestration engine
│   ├── queue.ts     # PostgreSQL job queue
│   ├── scheduler.ts # node-cron wrapper
│   ├── retry.ts     # Exponential backoff with jitter
│   ├── rate-limiter.ts  # Per-platform rate limiting
│   └── safety-guard.ts  # Content safety checks
├── ai/              # AI pipeline
│   ├── text-generator.ts   # Gemini text generation
│   ├── quality-checker.ts  # AI quality scoring
│   ├── image-generator.ts  # Image generation (Pollinations.ai + Pexels)
│   ├── tts.ts              # Text-to-speech (Edge TTS)
│   └── video-generator.ts  # FFmpeg video pipeline
├── platforms/       # Platform adapters
│   ├── base.ts      # Abstract base adapter
│   ├── twitter/     # Twitter API v2
│   ├── instagram/   # Instagram Graph API
│   ├── youtube/     # YouTube Data API
│   └── tiktok/      # TikTok HTTP API
├── plugins/         # Content source plugins
│   └── catpet/      # Example: animal adoption plugin
├── notifications/   # WhatsApp notifications
├── analytics/       # Post performance tracking
├── server/          # Web UI + REST API
│   ├── routes/      # API endpoints (projects, accounts, posts, dashboard)
│   └── views/       # Single-page dashboard
└── index.ts         # Entry point
```

## Web Dashboard

The built-in dashboard provides four main sections:

- **Projects** — Create and manage projects with per-project platform selection, tone, content type, prompt templates, and scheduling
- **Accounts** — Link social media accounts to projects with platform credentials and role assignment
- **Posts** — Browse, filter, and delete posts. Generate new content directly via Gemini with live preview
- **Dashboard** — Project-filtered statistics and recent post activity

## REST API

### Projects

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/projects` | List all projects (with account/post counts) |
| `POST` | `/api/projects` | Create project |
| `GET` | `/api/projects/:id` | Get project details |
| `PATCH` | `/api/projects/:id` | Update project |
| `DELETE` | `/api/projects/:id` | Delete project (warns if has related data) |

### Accounts

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/accounts?projectId=` | List accounts (optionally filtered by project) |
| `POST` | `/api/accounts` | Create account |
| `PATCH` | `/api/accounts/:id` | Update account |
| `DELETE` | `/api/accounts/:id` | Delete account |

### Posts

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/posts?projectId=&platform=&status=` | List posts with filters |
| `POST` | `/api/posts/generate` | Generate content via Gemini and save as review |
| `GET` | `/api/posts/:id` | Get post with analytics |
| `DELETE` | `/api/posts/:id` | Delete post |

### Dashboard

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/dashboard/stats?projectId=` | Post and job statistics |
| `GET` | `/api/dashboard/recent-posts?projectId=` | Last 20 posts |

## Writing Plugins

Plugins implement the `ProjectPlugin` interface to provide content from external sources:

```typescript
import type { ProjectPlugin, ContentRequest, GeneratedContent } from './types/index.js';

export class MyPlugin implements ProjectPlugin {
  name = 'my-plugin';

  async init(): Promise<void> {
    // Set up connections, prepare resources
  }

  async poll(): Promise<ContentRequest[]> {
    // Return new content requests from your source
    return [];
  }

  transform(content: GeneratedContent): GeneratedContent {
    // Optionally transform generated content
    return content;
  }

  getPrompt(request: ContentRequest): string {
    // Build the AI prompt for this request
    return 'Your prompt here...';
  }

  async destroy(): Promise<void> {
    // Clean up resources
  }
}
```

Register your plugin in the engine:

```typescript
import { engine } from './core/engine.js';
import { MyPlugin } from './plugins/my-plugin/index.js';

engine.registerPlugin(new MyPlugin());
```

## Tech Stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js 20+ |
| Language | TypeScript (strict mode) |
| Database | PostgreSQL + Drizzle ORM |
| AI | Google Gemini 2.5 Flash |
| Server | Express.js |
| Job Queue | PostgreSQL-native (SKIP LOCKED) |
| Scheduling | node-cron |
| TTS | Edge TTS |
| Video | FFmpeg |
| Validation | Zod |
| Logging | Winston |

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start with tsx (development) |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled output |
| `npm run db:push` | Push schema to database |
| `npm run db:generate` | Generate migrations |
| `npm run db:studio` | Open Drizzle Studio |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License — see [LICENSE](LICENSE) for details.
