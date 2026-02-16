FROM node:20-slim

WORKDIR /app

# Install bun for package management
RUN npm install -g bun

# Copy workspace files
COPY package.json bun.lock ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/queue/package.json ./packages/queue/
COPY packages/db/package.json ./packages/db/
COPY packages/env/package.json ./packages/env/
COPY packages/utils/package.json ./packages/utils/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY apps/worker ./apps/worker
COPY packages ./packages

WORKDIR /app/apps/worker

CMD ["npx", "tsx", "src/index.ts"]
