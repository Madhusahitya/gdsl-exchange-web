# gdsl-exchange-web — production image (standalone repo)
FROM node:20-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/dex-pancake/package.json ./packages/dex-pancake/
RUN npm ci
COPY apps/web ./apps/web
COPY packages/dex-pancake ./packages/dex-pancake
RUN npm run build --workspace=@cryptoflow/dex-pancake
ENV NEXT_TELEMETRY_DISABLED=1
ARG API_INTERNAL_ORIGIN=http://api:4000
ENV API_INTERNAL_ORIGIN=$API_INTERNAL_ORIGIN
ENV NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_WS_URL=ws://localhost:4000
ENV NEXT_PUBLIC_USE_API_PROXY=1
ARG NEXT_PUBLIC_APP_URL=https://trade.godslandx.com
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
ARG NEXT_PUBLIC_WALLETCONNECT_ENABLED=
ARG NEXT_PUBLIC_SOLANA_RPC_URL=
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ENV NEXT_PUBLIC_WALLETCONNECT_ENABLED=$NEXT_PUBLIC_WALLETCONNECT_ENABLED
ENV NEXT_PUBLIC_SOLANA_RPC_URL=$NEXT_PUBLIC_SOLANA_RPC_URL
RUN npm run build --workspace=apps/web

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/web ./apps/web
COPY --from=builder /app/packages/dex-pancake ./packages/dex-pancake
EXPOSE 3000
WORKDIR /app
CMD ["npm", "run", "start", "--workspace=apps/web"]
