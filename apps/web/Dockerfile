# syntax=docker/dockerfile:1

FROM node:20.18-slim AS base
# Install pnpm directly rather than via `corepack enable`: Corepack's bundled
# signing keys can lag npm's rotated keys, causing "Cannot find matching
# keyid" failures when it lazily fetches pnpm. Installing a pinned version
# via npm sidesteps that verification path entirely.
RUN npm install -g pnpm@9.15.0
WORKDIR /app

# ---- Prune: extract only what apps/web needs from the workspace ----
FROM base AS pruner
RUN npm install -g turbo@^2.3.0
COPY . .
RUN turbo prune @sph/web --docker

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
# graph — it doesn't know about tsconfig.base.json, which is referenced only
# via a relative `extends` path, so it's copied in explicitly here.
COPY tsconfig.base.json ./tsconfig.base.json

# Next.js inlines NEXT_PUBLIC_* into the CLIENT BUNDLE at BUILD time — setting
# them as Container Apps *runtime* env later will NOT change an already-built
# image, so they must be provided here as build args (CI passes them via
# --build-arg from non-secret GitHub repository variables). These are public,
# never secrets: the API's public URL, the public Entra client id, and the
# redirect URIs. Two are required (the app throws without them:
# msal-config.ts / api/client.ts); the two redirect URIs are optional and
# default client-side to the current origin when unset.
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_ENTRA_CLIENT_ID
ARG NEXT_PUBLIC_REDIRECT_URI
ARG NEXT_PUBLIC_ADMIN_CONSENT_REDIRECT_URI
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_ENTRA_CLIENT_ID=$NEXT_PUBLIC_ENTRA_CLIENT_ID \
    NEXT_PUBLIC_REDIRECT_URI=$NEXT_PUBLIC_REDIRECT_URI \
    NEXT_PUBLIC_ADMIN_CONSENT_REDIRECT_URI=$NEXT_PUBLIC_ADMIN_CONSENT_REDIRECT_URI

RUN pnpm turbo run db:generate --filter=@sph/web
RUN pnpm turbo run build --filter=@sph/web

# ---- Runtime: Next.js standalone output only, no full node_modules ----
FROM node:20.18-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "apps/web/server.js"]
