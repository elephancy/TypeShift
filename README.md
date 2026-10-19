# TypeShift Station

TypeShift is a Cloudflare-first typing game built on Next.js 16 and React 19. The published runtime is the `client/` app deployed to Cloudflare Workers via OpenNext, with D1 for core relational data, R2 for cache/backups, Turnstile for auth abuse protection, and Workers observability for logs and metrics.

## Current Launch Scope

Shipped for the Cloudflare launch:
- solo play across all typing modes
- local custom dictionaries without registration
- global leaderboard sessions and score submission
- daily challenge and seasonal ladder
- account registration/login with Turnstile
- account preferences, session management, password rotation, export, deletion
- replay sharing for signed-in accounts
- friend requests and friend list management
- live race rooms
- tournament brackets and spectator lookup
- ranked and casual duel queue flows
- webhook endpoint management
- privacy/legal pages and aggregate analytics summary

The current Worker API owns the production feature surface. The legacy Express server remains as reference code only.

## Architecture

- `client/`: deployed app, Cloudflare Worker target
- `client/app/api/v1/[...path]/route.ts`: Workers-native API surface
- `client/cloudflare/d1/migrations/`: D1 schema
- `client/wrangler.jsonc`: Worker bindings/config
- `server/`: legacy Express/Postgres implementation kept as reference only, not part of production deploys

## Local Development

Install everything from the repo root:

```bash
npm install
```

Run the Next dev server:

```bash
npm run dev -- --host 127.0.0.1 --port 5174
```

Open `http://127.0.0.1:5174`.

Preview the Cloudflare worker build locally:

```bash
npm run start -- --host 127.0.0.1 --port 8787
```

Smoke check the worker preview:

```bash
npm run smoke:check -- http://127.0.0.1:8787
```

## Environment

Public env values for the Next app live in `client/.env.example`.

Cloudflare local secret/binding development values live in `client/.dev.vars.example`.

Important public variables:

```env
NEXT_PUBLIC_SITE_NAME=TypeShift Station
NEXT_PUBLIC_SITE_URL=https://typeshift.dev
NEXT_PUBLIC_CONTROLLER_NAME=TypeShift Station Demo Operator
NEXT_PUBLIC_CONTACT_EMAIL=privacy@typeshift.dev
NEXT_PUBLIC_CONTACT_ADDRESS=Berlin, Germany
NEXT_PUBLIC_SUPPORT_EMAIL=support@typeshift.dev
NEXT_PUBLIC_DPO_EMAIL=
NEXT_PUBLIC_LEGAL_LAST_UPDATED=March 8, 2026
NEXT_PUBLIC_SCORE_RETENTION_DAYS=365
NEXT_PUBLIC_TELEMETRY_RETENTION_DAYS=30
NEXT_PUBLIC_TURNSTILE_SITE_KEY=your-turnstile-site-key
NEXT_PUBLIC_SOCIAL_LIVE_ENABLED=true
NEXT_PUBLIC_CLOUDFLARE_ONLY=true
```

Important worker secrets:

```env
JWT_SESSION_SECRET=replace-with-a-long-random-secret
TURNSTILE_SECRET_KEY=replace-with-your-turnstile-secret
METRICS_TOKEN=replace-with-a-private-admin-token
BOT_SEED_TOKEN=replace-with-a-private-bot-seed-token
```

## Scripts

- `npm run dev`: local Next dev server
- `npm run test`: integration tests for the Workers-native API plus typecheck
- `npm run build`: OpenNext Cloudflare build
- `npm run preview:worker`: local Wrangler preview
- `npm run deploy:worker`: build + deploy to Cloudflare Workers
- `ACCOUNT_TOKEN=... BOT_SEED_TOKEN=... npm run seed:bots -- https://typeshift.elfeel.me`: add/update capped synthetic leaderboard rows
- `npm run smoke:check -- <url>`: health and challenge smoke test

## Dependency Security

CI and production deployment run `npm audit --audit-level=high` before testing or deploying. Keep the lockfile committed.

The override for `@node-minify/core@9.0.2` replaces its pinned `glob@10.3.3` with the compatible patched `10.5.0` for [GHSA-5j98-mcp5-4vw2](https://github.com/advisories/GHSA-5j98-mcp5-4vw2). It is scoped to this minifier version and can be removed once OpenNext no longer pulls that vulnerable pin. The supported Next/OpenNext/Wrangler versions now resolve patched sharp directly, without the old global sharp pin.

## Deployment Notes

The Cloudflare Worker build remains the primary production target:

```bash
npm run build
npm run deploy:worker
```

For a Hetzner VPS, use the standard Next.js server build from `client/` behind your existing reverse proxy:

```bash
npm run build -w client
npm run start -w client -- --hostname 127.0.0.1 --port 3000
```

The current production API expects Cloudflare-style bindings for D1/R2/Turnstile. Moving the full backend to Hetzner needs a storage migration, not just a different process manager.

The repo includes:
- `.github/workflows/ci.yml`: tests, worker build, local Wrangler smoke preview
- `.github/workflows/release.yml`: production deploy to Cloudflare on `main`/`master` or manual dispatch
- `.github/workflows/backup.yml`: nightly D1 export uploaded to R2 and stored as a workflow artifact

## Data Protection and Ops

- D1 Time Travel is your short-window rollback path
- `.github/workflows/backup.yml` exports SQL backups to the `typeshift-backups` R2 bucket daily
- `/api/v1/privacy/analytics/summary` is protected by `METRICS_TOKEN` in production
- `/api/v1/admin/seed-bots` requires an allowlisted admin account plus `BOT_SEED_TOKEN` in production and upserts a capped set of uncertified bot leaderboard rows
- Workers observability is enabled in `client/wrangler.jsonc`
- The private centralized `ops` service owns external uptime checks and the shared project dashboard; this repository does not run a separate Prometheus, Alertmanager, or Grafana stack
- Legal routes are published at `/privacy-policy`, `/cookies`, and `/terms`

## Word Data

- `client/public/data/english-2-12.txt` is the broad alphabetical source dictionary used for fallback fills and domain-derived packs.
- `client/public/data/english-frequency-10k.txt` is a cleaned ranked-frequency list derived from `first20hours/google-10000-english`, used for `top1k`, `top5k`, and `top10k`.
- Admin users can inspect live pack counts and sample words from Profile -> Admin -> Pack QA.

## Notes

- Custom dictionaries stay local-first by design, so guests can use and customize the site without creating an account.
- Register/login flows require Turnstile in production.
- Game modes are deep-linkable under `/games/<mode-slug>`, for example `/games/sprint`, `/games/meteor`, and `/games/rhythm-chart`.
