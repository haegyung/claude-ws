FROM node:20-alpine AS base
RUN apk add --no-cache python3 make g++ gcc musl-dev libstdc++ && \
    corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
ENV CLAUDE_PROVIDER=sdk
ENV CI=true
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:20-alpine AS runner
RUN apk add --no-cache libstdc++ && \
    corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
ENV NODE_ENV=production
ENV CLAUDE_PROVIDER=sdk
ENV PORT=8556
ENV CI=true
COPY --from=builder /app ./
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 appuser && \
    mkdir -p /app/data && chown -R appuser:nodejs /app
USER appuser
EXPOSE 8556
CMD ["pnpm", "start"]
