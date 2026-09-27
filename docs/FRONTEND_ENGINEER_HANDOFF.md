# Frontend Engineer Handoff Guide

Welcome to the standalone Next.js frontend repository for **koie.fin / Godslandx** (`gdsl-exchange-web`).

- **Live Staging Domain**: `https://staging.eizy.trade`
- **Backend API Repository**: [gdsl-exchange-api](https://github.com/Madhusahitya/gdsl-exchange-api) (`https://staging-api.eizy.trade`)
- **Operations & Deployment Guide**: See [OPERATIONS_AND_DEPLOYMENT_GUIDE.md](OPERATIONS_AND_DEPLOYMENT_GUIDE.md)

---

## 1. Quick Start for Local Development

```bash
# 1. Install dependencies
npm install

# 2. Start development server
npm run dev
```

Open **http://localhost:3000** in your browser.

---

## 2. Port Architecture (Do Not Mix These Up)

| Service | Local Port | Production / Live Staging |
|:---|:---|:---|
| **Web Frontend** | `3000` (`http://localhost:3000`) | `https://staging.eizy.trade` (K8s pod via `hostPort: 3001`) |
| **Backend REST API** | `8000` (`http://localhost:8000`) | `https://staging-api.eizy.trade` |
| **WebSocket Gateway** | `8000` or `8001` (`ws://localhost:8000`) | `wss://staging-socket.eizy.trade` |

---

## 3. Environment Variables ([.env](file:///d:/faiz-p/gdsl-exchange-web/.env))

### Local Development against Live Staging Backend:
```env
NEXT_PUBLIC_USE_API_PROXY=0
NEXT_PUBLIC_API_URL=https://staging-api.eizy.trade
NEXT_PUBLIC_WS_URL=wss://staging-socket.eizy.trade
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Local Development against Local Backend API:
```env
NEXT_PUBLIC_USE_API_PROXY=0
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## 4. Codebase Directory Structure

| Path | Purpose |
|:---|:---|
| `src/app/` | Next.js 14 App Router pages (`(auth)`, `(dashboard)`, etc.) |
| `src/app/(dashboard)/dex/` | Primary BSC PancakeSwap / DEX trading terminal |
| `src/components/` | Reusable React UI components |
| `src/lib/api.ts` | Central Axios API client with automatic token refresh and cookies |
| `src/lib/dex/` | BSC token definitions, ABIs, swap routing, and calculators |
| `src/middleware.ts` | Next.js Edge route guard protecting dashboard routes |
| `docker/web.Dockerfile` | Multi-stage production container build |

---

## 5. Deployment Flow

1. **Build & Push Docker Image**:
   ```powershell
   npm run build
   docker build -t ghcr.io/faiyyajansari1466/gdsl-exchange-web:latest -f docker/web.Dockerfile .
   docker push ghcr.io/faiyyajansari1466/gdsl-exchange-web:latest
   ```

2. **Deploy on Droplet**:
   ```bash
   ssh root@139.59.30.70
   kubectl rollout restart deployment/gdsl-web -n gdsl-exchange
   ```

For full operational monitoring, live logs, and rollback instructions, refer to [docs/OPERATIONS_AND_DEPLOYMENT_GUIDE.md](OPERATIONS_AND_DEPLOYMENT_GUIDE.md).
