# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --legacy-peer-deps

COPY . .

RUN npx prisma generate
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001 -G nodejs && \
    chown -R nestjs:nodejs /app

COPY --chown=nestjs:nodejs package*.json ./
COPY --chown=nestjs:nodejs prisma ./prisma/

RUN npm ci --legacy-peer-deps --omit=dev && npx prisma generate

COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/.adminjs ./.adminjs

USER nestjs

EXPOSE 3000

ENV NODE_ENV=production

CMD ["npm", "run", "start:prod"]
