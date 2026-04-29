# joining-service — Agent Instructions

## Purpose

REST API (Hono on Node) that brokers joining flows for new Holochain
agents: serves membrane proofs, HTTP gateways, linker URLs, and hApp
bundles. Talks to the `@holo-host/lair` keystore (file dep at
`../holo-web-conductor/packages/lair`) for signing-key operations.
Consumed by the Unyt app and other hApps that need a joining
endpoint.

## Classification

`service` — deployed via `automation/` and / or Cloudflare (see
[`deploy/cloudflare/wrangler.toml`](deploy/cloudflare/wrangler.toml)
for the Worker variant).

## Stack

- **TypeScript / Node** — Hono framework, ESM module
  (`"type": "module"`). Build via `tsc`, dev via `tsx watch`.
- Tests via [Vitest](https://vitest.dev/).
- SQLite persistence via `better-sqlite3` for joining state.
- **No `flake.nix`** — runs in the host shell with Node 22+.
- File dep on `@holo-host/lair` from sibling
  [`holo-web-conductor`](../holo-web-conductor/) (untracked
  external — see workshop
  [AGENTS.md](../AGENTS.md#submodule-map--classification)).

## Build

```bash
npm install
npm run build           # tsc → dist/
npm run typecheck       # type-only check (no emit)
```

## Format

No `format` / `lint` script wired today. Apply, then verify, with
prettier directly:

```bash
npx prettier --write "src/**/*.{ts,tsx,json}" "test/**/*.{ts,tsx,json}"
npx prettier --check "src/**/*.{ts,tsx,json}" "test/**/*.{ts,tsx,json}"
```

If a `format` / `format:check` script is later wired into
`package.json`, prefer the script over `npx`.

## Test

```bash
npm test           # full Vitest run
npm run test:ui    # UI subset (Lit + Shoelace test components)
npm run test:watch # watch mode
```

## Run (local dev)

```bash
npm run dev        # tsx watch src/server.ts
```

The server reads its config from a JSON file passed as the first arg
(see [`README.md`](./README.md) and the `joining-config.*.json`
samples in the consumer side at
[`unyt-sandbox/unyt`](../unyt-sandbox/unyt/)).

## Deploy

Two deploy paths:

- **Node (server)**: via [`automation/`](../automation/) — typical
  systemd unit running `node dist/server.js <config>`.
- **Cloudflare Worker**: `( cd deploy/cloudflare && npx wrangler deploy )`
  — see [`deploy/cloudflare/wrangler.toml`](deploy/cloudflare/wrangler.toml).

## Related repos in workshop

- File dep on `@holo-host/lair` from external
  [`holo-web-conductor/packages/lair`](../holo-web-conductor/) (NOT
  a submodule — sibling clone).
- Consumed at runtime by [`unyt-sandbox/unyt`](../unyt-sandbox/unyt/)
  (and other Holochain apps that need a joining endpoint).
- Deployable via [`automation/`](../automation/).

## Changelog

File: [`./CHANGELOG.md`](./CHANGELOG.md). Format: [Keep a Changelog
1.1.0](https://keepachangelog.com/en/1.1.0/) with `## [Unreleased]`
at the top and standard subsections. One bullet per agent change,
≤120 chars, present-tense imperative. Branch-type → section mapping
per workshop
[`branch-and-pr-workflow.mdc`](../.cursor/rules/branch-and-pr-workflow.mdc).

API contract changes (route paths, request / response shapes) MUST
appear under `### Changed` — clients (the Unyt app, other hApps)
deserialize against this. Auth / signing-key handling changes
warrant `### Security`.

## Repo-specific rules

- **Sibling file-dep on `@holo-host/lair` is load-bearing.** The
  external `holo-web-conductor` checkout must be present at the
  expected path. Do not vendor `lair` here — keep it as a sibling
  dep so upstream changes flow through.
- **SQLite migrations are forward-only.** Adding columns is fine;
  destructive migrations (drop / rename) need an explicit migration
  step, not an ad-hoc schema change.
- **Membrane-proof signing** must use the configured signing key,
  never a development fallback baked into source.

## Lessons learned

_Append entries here whenever an agent (or human) loses time to
something a guardrail would have prevented. Keep each entry: date,
short symptom, concrete fix._
