# syntax=docker/dockerfile:1

# --- Build stage: compile the Vite/React static site ---
FROM node:22-alpine AS build
WORKDIR /app

# Install deps first for better layer caching. We use npm here (no workspace
# lockfile in this context) so the image is self-contained from website/.
COPY package.json ./
RUN npm install

# Build the static bundle into /app/dist
COPY . .
RUN npm run build

# --- Runtime stage: serve static files with nginx ---
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
