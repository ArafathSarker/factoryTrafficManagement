# syntax=docker/dockerfile:1

# ---------- dependencies ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs apiuser

COPY --from=build --chown=apiuser:nodejs /app/dist ./dist
COPY --chown=apiuser:nodejs package.json package-lock.json ./
COPY --chown=apiuser:nodejs node_modules ./node_modules

USER apiuser
EXPOSE 8080

# Boots the schema first (compiled from src/sql/dbObject.ts, connection string
# comes from DATABASE_URL) and then starts the API. The script reports per-object
# failures and exits, so a broken schema is visible in the container log.
CMD ["sh", "-c", "node dist/scripts/createSchema.js; exec node dist/server/server.js"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/junctions').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"