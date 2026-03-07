# Multi-stage Dockerfile for the joining service + static UI.
#
# Stage 1: Build the joining service from TypeScript source.
# Stage 2: Runtime with Node.js, nginx, and tini.
#
# Usage:
#   docker build -f deploy/edgenode/Dockerfile -t joining-service .
#
# The container expects:
#   - /data/joining-service/config.json  (service configuration)
#   - /data/joining-service/signing-key.pem  (ed25519 private key hex, optional)
#   - /data/ui/  (static UI assets, can be bind-mounted)

# ---- Stage 1: Build ----
#
# NOTE: @holo-host/lair is currently a file: dependency pointing at
# ../holo-web-conductor/packages/lair. Until it is published to npm,
# you must either:
#   a) publish @holo-host/lair to a registry, or
#   b) expand the build context to include the lair package and adjust
#      the file: path in package.json accordingly.
#
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# ---- Stage 2: Runtime ----
FROM cgr.dev/chainguard/wolfi-base

RUN apk update && apk add --no-cache \
  bash nodejs-20 npm tini nginx coreutils gosu

# Create non-root user (matches edgenode UID 65532)
RUN adduser -D -u 65532 nonroot nonroot || true

# Copy built joining service
COPY --from=builder /app/dist /opt/joining-service/dist
COPY --from=builder /app/node_modules /opt/joining-service/node_modules
COPY --from=builder /app/package.json /opt/joining-service/package.json

# Copy nginx config and entrypoint
COPY deploy/edgenode/nginx.conf /etc/nginx/nginx.conf
COPY deploy/edgenode/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Persistent data volume
VOLUME ["/data"]

# nginx serves on 8080
EXPOSE 8080

ENTRYPOINT ["tini", "--", "/usr/local/bin/entrypoint.sh"]
