# Complete Frontend Operations & Deployment Manual
**Target Architecture**: Next.js 14 Standalone Production Web on Kubernetes (K3s)  
**Domains**:
- **Live Frontend**: `https://staging.eizy.trade`
- **Backend API**: `https://staging-api.eizy.trade`
- **WebSockets**: `wss://staging-socket.eizy.trade`
- **Local Dev**: `http://localhost:3000` (or `http://localhost:8003`)

---

## Table of Contents
1. [Frontend Architecture & Traffic Flow](#1-frontend-architecture--traffic-flow)
2. [How to Deploy Frontend Code Changes (Local to Server)](#2-how-to-deploy-frontend-code-changes-local-to-server)
3. [How to Monitor Frontend Pods & Health](#3-how-to-monitor-frontend-pods--health)
4. [How to Stream Live Logs for the Frontend](#4-how-to-stream-live-logs-for-the-frontend)
5. [Local Development vs Live Staging Configuration](#5-local-development-vs-live-staging-configuration)
6. [Cookie, Auth & Session Architecture](#6-cookie-auth--session-architecture)
7. [What Files to Change If You Change Your Docker Username](#7-what-files-to-change-if-you-change-your-docker-username)
8. [Emergency Runbook & Zero-Downtime Rollback](#8-emergency-runbook--zero-downtime-rollback)

---

## 1. Frontend Architecture & Traffic Flow

The frontend runs as a containerized Next.js 14 application on Kubernetes inside the `gdsl-exchange` namespace.

```
                              Internet / Users
                                     │
                                     ▼
                    ┌─────────────────────────────────┐
                    │       DNS (staging.eizy.trade)  │
                    └────────────────┬────────────────┘
                                     │
                                     ▼
                    ┌─────────────────────────────────┐
                    │      Droplet Host NGINX         │
                    │   (Certbot SSL 80 / 443)        │
                    │   Upstream: 127.0.0.1:3001      │
                    └────────────────┬────────────────┘
                                     │
                                     ▼ (hostPort: 3001)
                    ┌─────────────────────────────────┐
                    │       K8s Pod: gdsl-web         │
                    │   Next.js Server (Port 3000)    │
                    │   Image: gdsl-exchange-web      │
                    └────────┬───────────────┬────────┘
                             │               │
        REST API Calls       │               │ WebSockets (WSS)
        (Bearer + Cookies)   │               │
                             ▼               ▼
                  https://staging-api   wss://staging-socket
                       .eizy.trade           .eizy.trade
```

### Key Networking Details:
1. **Host NGINX** listens on ports `80` and `443` with Let's Encrypt certificates at `/etc/nginx/sites-available/staging.eizy.trade`.
2. Host NGINX proxies incoming traffic to **`127.0.0.1:3001`**.
3. The Kubernetes `gdsl-web` pod uses **`hostPort: 3001`** mapped to its internal **`containerPort: 3000`**.
4. Authentication sessions are shared seamlessly between `staging.eizy.trade` and `staging-api.eizy.trade` using domain cookies (`.eizy.trade`).

---

## 2. How to Deploy Frontend Code Changes (Local to Server)

When you make changes to UI, components, or pages on your local machine, follow this **4-step zero-downtime deployment flow**:

### Step 2.1: Verify & Build on Local Machine
In your PowerShell terminal inside `D:\faiz-p\gdsl-exchange-web`:
```powershell
# 1. Verify build compiles cleanly with zero TypeScript errors
npm run build

# 2. Build the production Docker image
docker build -t ghcr.io/faiyyajansari1466/gdsl-exchange-web:latest -f docker/web.Dockerfile .
```

### Step 2.2: Push Image to GitHub Container Registry
```powershell
docker push ghcr.io/faiyyajansari1466/gdsl-exchange-web:latest
```

### Step 2.3: Trigger Zero-Downtime Rollout on Droplet
SSH into your droplet:
```bash
ssh root@139.59.30.70
```
Instruct Kubernetes to pull the new image and update the frontend:
```bash
kubectl rollout restart deployment/gdsl-web -n gdsl-exchange
```

### Step 2.4: Watch the Rollout Complete
```bash
kubectl rollout status deployment/gdsl-web -n gdsl-exchange
```
*Kubernetes spins up the new Next.js container, waits for the readiness check on `/` to pass, and switches traffic over seamlessly.*

---

## 3. How to Monitor Frontend Pods & Health

All commands run on your Linux Droplet terminal (SSH).

### 3.1 Check Web Pod Status
```bash
kubectl get pods -n gdsl-exchange -l app=gdsl-web
```
**Healthy Output:**
```text
NAME                        READY   STATUS    RESTARTS   AGE
gdsl-web-xxxxxxxxxx-xxxxx   1/1     Running   0          2m
```

### 3.2 Verify Host Port 3001 Listener on Droplet
Test that the Kubernetes pod is actively answering host port 3001:
```bash
curl -I http://127.0.0.1:3001
```
*(Should return `HTTP/1.1 200 OK` or `HTTP/1.1 307 Temporary Redirect` to `/dex`)*.

### 3.3 Verify Public HTTPS Domain
```bash
curl -I https://staging.eizy.trade
```
*(Should return `HTTP/2 200` or `307`)*.

### 3.4 Check Live Resource Usage (CPU and RAM)
```bash
kubectl top pods -n gdsl-exchange -l app=gdsl-web
```

### 3.5 Diagnose Pod Crash or Failure
If the pod ever shows `CrashLoopBackOff` or `Error`:
```bash
kubectl describe pod -n gdsl-exchange -l app=gdsl-web
```
*(Scroll to the bottom under **Events** to see the exact issue).*

---

## 4. How to Stream Live Logs for the Frontend

Use the `-f` (follow) flag to watch Next.js server logs in real time. Press `Ctrl + C` to exit.

### 4.1 Stream All Frontend Logs
```bash
kubectl logs -f -l app=gdsl-web -n gdsl-exchange --tail=100
```

### 4.2 Stream Only Errors
```bash
kubectl logs -f -l app=gdsl-web -n gdsl-exchange | grep -i --color=auto "error"
```

### 4.3 View Previous Crashed Pod Logs
If a pod crashed and restarted:
```bash
kubectl logs -l app=gdsl-web -n gdsl-exchange --previous
```

---

## 5. Local Development vs Live Staging Configuration

The frontend dynamically resolves API and WebSocket URLs using [.env](file:///d:/faiz-p/gdsl-exchange-web/.env).

### Mode A: Local Frontend + Local Backend API
Use this when you are running both frontend and backend on your laptop:
```env
NEXT_PUBLIC_USE_API_PROXY=0
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```
- Frontend runs at: `http://localhost:3000`
- Backend runs at: `http://localhost:8000`

### Mode B: Local Frontend + Live Staging Backend API
Use this when you want to develop UI locally on your laptop without running PostgreSQL/Redis locally:
```env
NEXT_PUBLIC_USE_API_PROXY=0
NEXT_PUBLIC_API_URL=https://staging-api.eizy.trade
NEXT_PUBLIC_WS_URL=wss://staging-socket.eizy.trade
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> [!IMPORTANT]
> **Next.js does not hot-reload `.env` changes.**  
> Whenever you modify `.env`, you must press `Ctrl + C` in your terminal and re-run `npm run dev`.

---

## 6. Cookie, Auth & Session Architecture

### How Cross-Subdomain Authentication Works:
- Frontend Domain: `https://staging.eizy.trade`
- Backend Domain: `https://staging-api.eizy.trade`

When a user logs in via `POST /api/auth/login`:
1. The backend issues JWT tokens:
   - `cf_token`: Access token (valid for 15 minutes)
   - `cf_refresh_token`: Refresh token (valid for 7 days)
   - `cf_csrf`: CSRF token for mutating requests
2. In production, these cookies are issued with **`Domain=.eizy.trade; SameSite=Lax; Secure`**.
3. Because the domain is `.eizy.trade`, **both** `staging.eizy.trade` and `staging-api.eizy.trade` receive the cookies.
4. Next.js server middleware ([src/middleware.ts](file:///d:/faiz-p/gdsl-exchange-web/src/middleware.ts)) reads `request.cookies.get('cf_token')` or `cf_refresh_token` to authorize access to protected routes:
   - `/dashboard`
   - `/dex`
   - `/trading`
   - `/wallet`
   - `/history`
   - `/settings`
5. If the session is missing or expired, middleware automatically redirects to `/login?next=<path>`.

---

## 7. What Files to Change If You Change Your Docker Username

If you ever change your GitHub username or Docker Registry account (e.g., from `faiyyajansari1466` to `newusername`):

### 7.1 Code Files to Update:

| # | File Path | Line | What to Change |
| :--- | :--- | :--- | :--- |
| 1 | `k8s/web-deployment.yaml` | `28` | `image: ghcr.io/newusername/gdsl-exchange-web:latest` |
| 2 | `docs/FRONTEND_ENGINEER_HANDOFF.md` | `56` | Update image reference to `newusername` |
| 3 | `docs/OPERATIONS_AND_DEPLOYMENT_GUIDE.md` | All | Update image reference to `newusername` |

### 7.2 Commands to Run After Changing Username:

#### 1. On your Local Computer:
```powershell
docker login ghcr.io -u newusername
docker build -t ghcr.io/newusername/gdsl-exchange-web:latest -f docker/web.Dockerfile .
docker push ghcr.io/newusername/gdsl-exchange-web:latest
```

#### 2. On your Droplet Server:
Apply the updated deployment manifest:
```bash
kubectl apply -f k8s/web-deployment.yaml
kubectl rollout restart deployment/gdsl-web -n gdsl-exchange
```

---

## 8. Emergency Runbook & Zero-Downtime Rollback

### 8.1 Instant Rollback to Previous Deployment
If a new frontend build has a breaking bug or UI crash, roll back instantly to the previous working Docker container:
```bash
kubectl rollout undo deployment/gdsl-web -n gdsl-exchange
```
*Kubernetes instantly brings back the previous container image with **zero downtime**.*

### 8.2 View Deployment Revision History
```bash
kubectl rollout history deployment/gdsl-web -n gdsl-exchange
```

### 8.3 Restart Frontend Pod
If the frontend container ever becomes unresponsive or runs out of memory:
```bash
kubectl rollout restart deployment/gdsl-web -n gdsl-exchange
```

### 8.4 Clean Next.js Build Cache (Local Dev)
If local Next.js hangs or `.next` cache gets corrupted:
```powershell
npm run dev:clean
```
*(Automatically deletes `.next` and restarts on port 3000).*
