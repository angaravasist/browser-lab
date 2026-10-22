# BrowserLab app image: Fastify API + built web UI + generic fixture site. Multi-arch (amd64, arm64).
# Never gets the Docker socket.
FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
WORKDIR /src
# better-sqlite3 normally uses a prebuilt binary; the toolchain is only a fallback.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps apps
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
ENV NODE_ENV=production BROWSERLAB_DATA_DIR=/data BROWSERLAB_LISTEN_HOST=0.0.0.0 BROWSERLAB_PORT=3000
WORKDIR /app
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules node_modules
COPY --from=build /src/packages/shared packages/shared
COPY --from=build /src/apps/api/package.json apps/api/
COPY --from=build /src/apps/api/src apps/api/src
COPY --from=build /src/apps/web/dist apps/web/dist
COPY browser-images/catalog.json browser-images/
COPY tests/fixtures/site tests/fixtures/site
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "apps/api/src/server.ts"]
