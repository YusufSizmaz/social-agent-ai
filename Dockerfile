FROM node:20-slim AS base

# Chromium for whatsapp-web.js, FFmpeg for the video pipeline, fonts for subtitles
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    ca-certificates \
    fonts-liberation \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app

# ---------- deps ----------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------- build ----------
FROM base AS build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src/ src/
RUN npm run build

# ---------- runtime ----------
FROM base AS runtime
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY drizzle ./drizzle

# Run as an unprivileged user; pre-create writable dirs so named volumes inherit ownership
RUN mkdir -p temp public .wwebjs_auth && chown -R node:node temp public .wwebjs_auth
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
