# Multi-stage production build for standalone Next.js (gdsl-exchange-web)
FROM node:20-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --legacy-peer-deps

# Copy source code and configurations
COPY . .

# Production environment variables baked into Next.js bundle at build time
ARG NEXT_PUBLIC_API_URL=https://staging-api.eizy.trade
ARG NEXT_PUBLIC_WS_URL=wss://staging-socket.eizy.trade
ARG NEXT_PUBLIC_APP_URL=https://staging.eizy.trade
ARG NEXT_PUBLIC_USE_API_PROXY=0

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_USE_API_PROXY=$NEXT_PUBLIC_USE_API_PROXY
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# Runner stage
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.js ./

EXPOSE 3000
CMD ["npm", "run", "start"]
