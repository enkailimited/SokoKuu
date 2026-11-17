# ==============================================================================
# SokoKuu TZ — Multi-Stage NestJS Backend Dockerfile (Non-Root Production Image)
# ==============================================================================

FROM node:22-alpine AS builder
WORKDIR /app/backend

ENV TZ=Africa/Dar_es_Salaam
RUN apk add --no-cache openssl tzdata

COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY backend/tsconfig.json backend/tsconfig.build.json backend/nest-cli.json ./
COPY backend/prisma ./prisma
COPY backend/src ./src

RUN npx prisma generate --schema=./prisma/schema.prisma
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app/backend

ENV NODE_ENV=production
ENV PORT=3001
ENV TZ=Africa/Dar_es_Salaam

RUN apk add --no-cache openssl tzdata dumb-init \
    && addgroup -S sokokuu \
    && adduser -S -G sokokuu sokokuu

COPY --from=builder --chown=sokokuu:sokokuu /app/backend/node_modules ./node_modules
COPY --from=builder --chown=sokokuu:sokokuu /app/backend/dist ./dist
COPY --from=builder --chown=sokokuu:sokokuu /app/backend/prisma ./prisma
COPY --from=builder --chown=sokokuu:sokokuu /app/backend/package.json ./package.json

USER sokokuu
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/api/v1/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
