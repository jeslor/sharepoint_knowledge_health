# syntax=docker/dockerfile:1

FROM node:20.18-slim AS base
# Install pnpm directly rather than via `corepack enable`: Corepack's bundled
# signing keys can lag npm's rotated keys, causing "Cannot find matching
# keyid" failures when it lazily fetches pnpm. Installing a pinned version
# via npm sidesteps that verification path entirely.
RUN npm install -g pnpm@9.15.0
# Prisma's query engine needs libssl; node:20.18-slim doesn't ship it.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- Prune: extract only what apps/worker needs from the workspace ----
FROM base AS pruner
RUN npm install -g turbo@^2.3.0
COPY . .
RUN turbo prune @sph/worker --docker

# ---- Install: dependencies from the pruned package.json set only ----
FROM base AS installer
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile

# ---- Build: full pruned source, generate Prisma client, build the app ----
FROM base AS builder
RUN npm install -g turbo@^2.3.0
COPY --from=installer /app/ .
COPY --from=pruner /app/out/full/ .
# turbo prune only copies files reachable through the pnpm workspace package
# graph — it doesn't know about root-level files referenced only via
# relative paths (tsconfig `extends`, Prisma's `schema` package.json field),
# so they're copied in explicitly here.
COPY tsconfig.base.json ./tsconfig.base.json
COPY prisma ./prisma
# Dummy value: prisma generate only needs DATABASE_URL to be syntactically
# present to parse the schema, it never connects to a real database at
# generate time. The real value is injected at container runtime instead.
ENV DATABASE_URL="postgresql://user:password@localhost:5432/db"
RUN pnpm turbo run db:generate --filter=@sph/worker
RUN pnpm turbo run build --filter=@sph/worker

# ---- Runtime: prod deps only, non-root user, no exposed port ----
# apps/worker has no HTTP ingress (ADR-0009) — it consumes from the Redis
# queue only, so intentionally there is no EXPOSE here.
FROM node:20.18-slim AS runner
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nestjs && adduser --system --uid 1001 nestjs
COPY --from=builder --chown=nestjs:nestjs /app .
USER nestjs
CMD ["node", "apps/worker/dist/main.js"]
