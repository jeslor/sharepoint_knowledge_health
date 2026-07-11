# syntax=docker/dockerfile:1

FROM node:20.18-slim AS base
RUN corepack enable
WORKDIR /app

# ---- Prune: extract only what apps/api needs from the workspace ----
FROM base AS pruner
RUN npm install -g turbo@^2.3.0
COPY . .
RUN turbo prune @sph/api --docker

# ---- Install: dependencies from the pruned package.json set only ----
FROM base AS installer
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

# ---- Build: full pruned source, generate Prisma client, build the app ----
FROM base AS builder
RUN npm install -g turbo@^2.3.0
COPY --from=installer /app/ .
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run db:generate --filter=@sph/api
RUN pnpm turbo run build --filter=@sph/api

# ---- Runtime: prod deps only, non-root user ----
FROM node:20.18-slim AS runner
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nestjs && adduser --system --uid 1001 nestjs
COPY --from=builder --chown=nestjs:nestjs /app .
USER nestjs
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
