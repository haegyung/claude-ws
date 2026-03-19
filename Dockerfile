FROM node:20-alpine
RUN apk add --no-cache python3 make g++ gcc musl-dev libstdc++ && \
    corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy everything including pre-built .next from host
COPY . .

# Install production deps and rebuild native modules for linux/musl
ENV CI=true
RUN rm -rf node_modules && \
    pnpm install --frozen-lockfile --prod=false

# Remove build tools to reduce image size
RUN apk del python3 make g++ gcc musl-dev

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 appuser
RUN chown -R appuser:nodejs /app
USER appuser
EXPOSE 3000
CMD ["pnpm", "start"]
