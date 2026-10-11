# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## Product invariants — never break these

1. **Local-first.** No accounts, no telemetry, no hosted backend. The only network calls go to services the user configured: model providers, Firecrawl, Telegram (and a Cloudflare quick tunnel for phone take-over links). Agents' machines run in Docker on the user's computer.
2. **Agents never act on the host.** Every agent tool that executes something does so in the agent's Docker workstation (`lib/workstation.ts`). Never mount host paths into it.
3. **Secrets stay on the server.** Never return a raw key from a server action or render one in a component; use `describeSetting()` which masks them.
4. **Loopback only.** Don't weaken `proxy.ts`.

## Stack

- Next.js 16 (App Router, Turbopack). Read the bundled docs in `node_modules/next/dist/docs/` before using a Next API — it differs from older versions (e.g. `proxy.ts` replaces middleware).
- AI SDK 7: `instructions` (not `system`), `isStepCount`, `onEnd`/`onStepEnd`, tool results as `{ type: "file" }`. Docs in `node_modules/ai/docs/`.
- SQLite via `better-sqlite3` + Drizzle. Queries are synchronous: use `.get()`, `.all()`, `.run()`, and `.sync()` on relational queries.
- UI primitives in `components/ui` (Base UI). Buttons rendering links need `nativeButton={false}`.

## Commands

```bash
npm run dev          # :6796
npm run check        # typecheck + lint + format check — run before finishing
npm run build
npm run db:generate  # after editing db/schema.ts; commit the migration
```

## Conventions

- Mutations go through `actions/*.ts` (`"use server"`), validated with the zod schemas exported from `db/schema.ts`.
- Reads for server components go in `queries/`.
- Settings: add new keys to the registry in `lib/config.ts`; never read `process.env` for user-configurable values elsewhere.
- Tools: add to `lib/agent/tools.ts`, render in `components/thread/tool-call.tsx`, label in `lib/telegram/bridge.ts`.
- Styling: design tokens in `app/globals.css` (`rigel` accent, `betelgeuse` secondary, `label-mono` for small caps metadata).
- Conventional Commits.

## Testing changes that call models

Model calls cost the user money. Prefer short prompts, and test integrations (Telegram, providers) against local mocks where possible.
