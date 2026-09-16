# Frontend handoff

Hey — this is the web repo. Don't clone `gdsl-exchange` for frontend work; that's the deploy/orchestration repo now.

Backend API is separate: [gdsl-exchange-api](https://github.com/Madhusahitya/gdsl-exchange-api).

## Get running locally

```bash
git clone git@github.com:Madhusahitya/gdsl-exchange-web.git
cd gdsl-exchange-web
cp apps/web/.env.example apps/web/.env.local
npm install
npm run dev
```

Open **http://localhost:8003**

### Ports (don't mix these up)

| What | Port |
|------|------|
| **Web app (this repo, local dev)** | **8003** |
| **API (local dev)** | **8000** — run from gdsl-exchange-api |
| **API (production / Docker on droplet)** | **4000** |
| **Web (production Docker on droplet)** | **3000** (nginx serves trade.godslandx.com) |

Set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` to `http://localhost:8000` / `ws://localhost:8000` when running the API locally.

For UI-only work, ask me for a staging API URL instead of running the backend yourself.

### WalletConnect

You need `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` from [WalletConnect Cloud](https://cloud.walletconnect.com/) for BSC wallet UI. Put it in `apps/web/.env.local`.

---

## Where the code is

| Path | Purpose |
|------|---------|
| `apps/web/src/app/` | Next.js App Router pages |
| `apps/web/src/components/` | UI components |
| `apps/web/src/lib/api.ts` | API client |
| `apps/web/src/hooks/useSocket.ts` | Socket.IO hook |
| `packages/dex-pancake/` | Shared BSC/Pancake ABIs (small package) |

Main dashboard routes live under `apps/web/src/app/(dashboard)/`.

---

## Deploy

Push to `main` → CI runs here → triggers `gdsl-exchange` to build the Docker image → deploys to the droplet.

Image: `ghcr.io/madhusahitya/gdsl-exchange-web:latest`

**Do not push directly to production configs.** Open PRs; CI must pass.

---

## Staging subdomain (coming)

We're setting up something like `staging.trade.godslandx.com` so you can preview changes without touching the live site. Ping me when you need access — don't deploy experimental stuff to the main domain.
