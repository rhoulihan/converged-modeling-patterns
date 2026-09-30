# app/Dockerfile
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
RUN npm run build:vendor

FROM deps AS test
COPY patterns /patterns
ENV PATTERNS_DIR=/patterns
CMD ["npx", "vitest", "run"]

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=deps /app/src ./src
COPY --from=deps /app/sql ./sql
COPY --from=deps /app/public ./public
COPY patterns /patterns
ENV PATTERNS_DIR=/patterns PORT=3000
EXPOSE 3000
USER node
CMD ["node", "src/server.js"]
