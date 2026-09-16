# gdsl-exchange-web

Standalone frontend for **Godslandx / koie.fin** — Next.js 14, Tailwind, WalletConnect, Jupiter/CEX trading UI.

| Repo | What |
|------|------|
| **This repo** | Next.js web app |
| [gdsl-exchange-api](https://github.com/Madhusahitya/gdsl-exchange-api) | Express API + Socket.IO |
| [gdsl-exchange](https://github.com/Madhusahitya/gdsl-exchange) | Deploy hub (docker-compose, droplet CI) |

Production: [trade.godslandx.com](https://trade.godslandx.com)

## Quick start

```bash
git clone git@github.com:Madhusahitya/gdsl-exchange-web.git
cd gdsl-exchange-web
cp apps/web/.env.example apps/web/.env.local
npm install
npm run dev    # http://localhost:8003
```

Run the API from [gdsl-exchange-api](https://github.com/Madhusahitya/gdsl-exchange-api) on port **8000** for full-stack local dev.

Full handoff: [`docs/FRONTEND_ENGINEER_HANDOFF.md`](docs/FRONTEND_ENGINEER_HANDOFF.md)

## Deploy

Push to `main` → builds `ghcr.io/madhusahitya/gdsl-exchange-web:latest` via the gdsl-exchange deploy workflow.
