# syntax=docker/dockerfile:1.24@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89

# Base image pinned by digest for supply-chain safety. To update: pull the
# latest node:24-alpine, copy its sha256 digest from `docker inspect`, and
# replace below. Renovate's docker manager (via the central config in
# mikimatsub/.github) will also propose digest bumps automatically.
ARG NODE_IMAGE=node:24-alpine@sha256:2bdb65ed1dab192432bc31c95f94155ca5ad7fc1392fb7eb7526ab682fa5bf14

# === Builder stage ===
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

# Copy manifests first so npm ci is cached when only source changes.
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build. The build chains `vite build` (UI bundles) + `tsc`
# (server), so Vite's config, the UI tsconfig, and the scripts/ helpers are
# all required at build time.
COPY tsconfig.json tsconfig.ui.json vite.config.ts ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# Drop devDependencies for the runtime stage
RUN npm prune --omit=dev


# === Runtime stage ===
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

# Copy production deps and built artifacts only. Explicit ownership avoids
# permission issues when running as the non-root `node` user.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json

USER node

ENV NODE_ENV=production
ENV PORT=3000
# HTTP transport is the only sensible default in a container; stdio expects
# to be spawned by an MCP host as a subprocess. Override via -e SWSD_TRANSPORT=stdio
# if you really need stdio inside a container (rare).
ENV SWSD_TRANSPORT=http

EXPOSE 3000

# /healthz returns 200 with {"ok":true,...} when the server is responsive.
# Uses Node 24's built-in fetch — no curl/wget needed in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

LABEL org.opencontainers.image.source="https://github.com/mikimatsub/MCP-SWSD"
LABEL org.opencontainers.image.description="MCP server for SolarWinds Service Desk (SWSD / Samanage). Stdio + Streamable HTTP transports."
LABEL org.opencontainers.image.licenses="MIT"

CMD ["node", "dist/cli.js"]
