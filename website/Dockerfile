# syntax=docker/dockerfile:1

# --- Build stage: compile the Vite/React static site ---
FROM node:22-alpine AS build
WORKDIR /app

# Build from the repository root:
# docker build -f website/Dockerfile -t hammadev-website .
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml product-contract.json ./
COPY website/package.json ./website/package.json
RUN pnpm install --frozen-lockfile --filter hammadev-website

# Vite reads the root package version and product contract during the website
# build, so both are deliberately part of the immutable build context above.
COPY website ./website
RUN pnpm --dir website build

# --- Runtime stage: serve static files with nginx ---
FROM nginx:1.27-alpine AS runtime
COPY website/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/website/dist /usr/share/nginx/html
EXPOSE 80
