# syntax=docker/dockerfile:1

# Pinned to node 22.23.5-bookworm-slim, multi-arch index digest
# sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
# (same digest as the floating 22-bookworm-slim tag on 2026-11-16).
# Bump both tag and digest together; a digest alone hides which Node you run.
ARG NODE_IMAGE=node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee

FROM ${NODE_IMAGE} AS build
WORKDIR /app

# better-sqlite3 is a native module and has no prebuilt binary for every Node
# release, so the build stage needs a compiler and python3 for node-gyp.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY dashboard ./dashboard
COPY public ./public

# Builds dist/ (tsc) and public/admin/ (vite). public/admin is gitignored, so it
# only ever exists because this step ran.
RUN npm run build \
 && npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=8000 \
    HOST=0.0.0.0 \
    DB_PATH=/data/notulen.db \
    ADMIN_LOCK=off
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app \
 && mkdir -p /data \
 && chown 10001:10001 /data

VOLUME ["/data"]
USER 10001:10001
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
