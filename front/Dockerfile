# syntax=docker/dockerfile:1.7
# Imagen de producción mínima (Next.js standalone). ~150 MB, corre como usuario sin privilegios.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Se leen al compilar: el proxy /api/v1 y el nombre comercial quedan fijos en el build.
ARG API_ORIGIN=http://api:3000
ARG NEXT_PUBLIC_APP_NAME="Comercio ERP"
ENV API_ORIGIN=$API_ORIGIN NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3001/login >/dev/null || exit 1
CMD ["node", "server.js"]
