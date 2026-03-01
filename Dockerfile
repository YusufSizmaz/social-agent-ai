FROM node:20-slim AS base

# Install Chromium dependencies for whatsapp-web.js + ffmpeg for video pipeline
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    ca-certificates \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# ---------- deps ----------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------- build ----------
FROM base AS build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src/ src/
RUN npm run build

# ---------- runtime ----------
FROM base AS runtime
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY src/server/views ./dist/server/views

RUN mkdir -p temp

EXPOSE 3000

CMD ["node", "dist/index.js"]
