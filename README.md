# SutraAI

SutraAI is a conversational website builder: small businesses describe what they want in natural language, and an AI assistant maintains a structured site configuration that can be rendered into a live site. Each customer is a **tenant** identified by a subdomain slug; their layout, copy, colors, and sections live in a JSON document persisted in PostgreSQL and updated turn-by-turn through chat.

## Vision

Building a credible web presence should not require juggling CMS panels, themes, and copy docs. SutraAI treats a site as **declarative state** (`jsonState`) that humans edit through conversation. The assistant merges each request into the full configuration—business name, tagline, accent colors, page sections—and the backend stores the result per tenant so the same slug always reflects the latest design.

Long term, the product aims at **multi-tenant, subdomain-hosted sites** where onboarding is chat-first, changes are auditable in the database, and the frontend renders whatever the model and user agree on—without hand-editing JSON for routine updates.

## Target users and outcomes

| Audience | What they get |
|----------|----------------|
| Small businesses and solo operators | A guided way to stand up and iterate on a simple marketing site |
| Platform operators | One API and data model for many tenants (`subdomainSlug`, plan, contact) |
| Developers extending SutraAI | A clear split: **API + persistence** (`backend-api`) and **UI / site renderer** (`web`) |

Success looks like: a tenant sends “make the hero tagline about sustainable packaging,” receives a natural-language reply, and their stored `jsonState` updates in one request—ready for a renderer to show on `{slug}.yourdomain`.

## How it works (today)

1. The **web** app (dev harness) calls `POST /api/chat` with `subdomainSlug`, message history, and current `jsonState`.
2. The **sutra** service loads the tenant from Postgres, builds a system prompt with tenant context and current state, and calls **OpenRouter** (OpenAI-compatible) for a JSON response: `{ "reply", "jsonState" }`.
3. Valid responses are written back to the tenant row; the client displays the reply and refreshed state.

Shared infrastructure includes Express (`base-server`), structured logging, CORS, health checks, and CLI flags for Postgres and OpenRouter (see `backend-api/.env.example`).

## Repository structure

```
SutraAI/
├── README.md                 # This file
├── .gitignore
├── backend-api/              # Node/Express API (TypeScript)
│   ├── src/
│   │   ├── services/sutra/ # Sutra service entrypoint, /api/chat, chatHandler
│   │   ├── lib/            # Express base server, OpenRouter client, logger
│   │   │   └── postgres-prisma/  # Prisma schema, DbService, CLI DB options
│   │   ├── middleware/     # HTTP and request lifecycle logging
│   │   └── types/          # Express type extensions
│   ├── test/               # Mocha tests (services + lib)
│   ├── .env.example        # Local env template (OpenRouter, Postgres, CORS)
│   └── package.json        # dev, build, test, prisma scripts
└── web/                      # React + Vite + Tailwind (frontend)
    ├── src/
    │   ├── App.tsx         # Health check + chat demo against the API
    │   ├── main.tsx
    │   └── index.css
    ├── vite.config.js
    └── package.json
```

### Backend highlights

- **`SutraServer`** (`backend-api/src/services/sutra/index.ts`): wires Postgres + OpenRouter, exposes `/health`, `/sutra`, and `POST /api/chat`.
- **`chatHandler`**: validates requests, system prompt for site-builder JSON, model parsing and OpenRouter completion.
- **`Tenant`** model (`schema.prisma`): `subdomainSlug`, `businessName`, `jsonState` (JSONB), plan and contact fields.

### Frontend highlights

- **`web`**: minimal UI to probe `/health` and exercise chat; `VITE_API_URL` defaults to `http://localhost:3000`.

## Quick start (local)

**Backend** (from `backend-api/`):

- Copy `.env.example`, set `OPENROUTER_API_KEY` (base64 per project convention) and `DATABASE_URL`.
- Run Prisma against your database: `npm run prisma:push` (or migrate).
- Seed or create a `Tenant` row for your test slug.
- `npm run dev` with CLI flags or env as documented in `.env.example`.

**Frontend** (from `web/`):

- `npm run dev` — Vite on port 5173; ensure CORS includes the dev origin.

**Verify chat loop:**

1. Start backend (smoke uses `SMOKE_API_URL` or `http://HOST:PORT` from env, default **3000**) and frontend (`npm run dev` in `web/`, port 5173; CORS must allow the Vite origin).
2. Open the dashboard; keep subdomain slug `acme` (tenant row must exist).
3. Send a prompt that should change visible content (e.g. hero copy or tagline).
4. Confirm: assistant reply appears; **Show JSON** reflects the new `jsonState`; the right-side preview updates without a page refresh.
5. Optionally run `npm run smoke` in `backend-api/` (loads `backend-api/.env` if present; needs the API up, `DATABASE_URL` or base64 `PGPASSWORD` like `--pg-password`, and `SMOKE_API_URL` only if the API is not reachable at the default `http://localhost:3000`) to assert API + Prisma persistence via a unique `tagline` marker.

**Tests** (backend): `npm test` in `backend-api/`.

---

SutraAI is early-stage: the chat loop and tenant persistence are in place; the public site renderer and full subdomain hosting are the natural next layers on top of `jsonState`.
