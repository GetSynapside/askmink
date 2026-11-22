# Askmink (*by Synapside*)

Open-core, self-hostable embedded AI agent for **Sales** and **Technical Support** with Hybrid RAG (`pgvector` multi-dimension + `tsvector` RRF), Generative UI, No-Code HTTP Tool Builder (with immutable JWT `{{session.*}}` claims & Human-in-the-Loop confirmation), Remote MCP client, Native Scheduler (`.ics`), and a `< 10 KB` gzipped Shadow DOM widget.

> License: **FSL-1.1-MIT**

## Quickstart (`docker compose up`)

1. Copy `.env.example` to `.env` and set strong random 64-char hex values for `ENCRYPTION_KEY` and `SESSION_SECRET` (or run the setup script below).
2. Configure your Vercel AI Gateway token & default models:
   ```bash
   ./scripts/configure-ai-gateway.sh
   ```
3. Start PostgreSQL 18 (`pgvector`) + Askmink:
   ```bash
   docker compose up --build -d
   ```
   Migrations run automatically on server boot. Verify with `curl http://127.0.0.1:3000/health`.

## Local Development (`pnpm`)

```bash
# Start PostgreSQL 18 + pgvector
docker compose up -d postgres

# Install dependencies & build
pnpm install
pnpm build

# Run API (port 3000) + Admin Web (port 5173) + Widget watcher
pnpm dev

# Run E2E tests against real PostgreSQL 18 + pgvector + pg-boss
pnpm test:e2e
```

## Coolify Deployment (`https://app.askmink.synapside.com/`)

1. Point Coolify to the `Dockerfile` in this repository (multi-stage Node 22 build bundling API + Admin SPA + `widget.js`).
2. Attach a PostgreSQL 18 service with `pgvector` enabled (`pgvector/pgvector:pg18`).
3. Configure environment variables (`DATABASE_URL`, `ENCRYPTION_KEY`, `SESSION_SECRET`, `APP_URL=https://app.askmink.synapside.com`, `APP_MODE=self-hosted` or `cloud` with Auth0 vars).
4. Healthcheck endpoint: `GET /health`.
