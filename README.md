# Holo Joining Service

Standardized REST API for onboarding agents into Holochain apps.

## What This Is

A per-hApp service that brokers the data a Holochain client needs to connect a new agent to a network. Each capability is independently optional — deploy only what your hApp requires:

- **Membrane proofs** — cryptographic authorization to join (per-hApp, per-DNA)
- **HTTP gateways** — read-only access before the agent has joined
- **Linker URLs** — relay servers for browser-based nodes (HWC / Holo-specific)
- **hApp bundles** — the application WASM and manifest URL

This service is not HWC-specific. It works for any Holochain deployment context — browser-based nodes that need linker relay URLs, native nodes that only need membrane proofs, gateway-only read access, or any combination.

## Documents

- [JOINING_SERVICE_API.md](./JOINING_SERVICE_API.md) — Full REST API specification
- [ARCHITECTURE.md](./ARCHITECTURE.md) — Overview of the different node types the service supports, flow diagrams, and the spectrum of configuration profiles and development directions.
- [DEPLOYMENT.md](./DEPLOYMENT.md) — Deployment guide (local, Cloudflare Workers, edge node)

## Quick Summary

```
Agent starts up
  → GET /.well-known/holo-joining         (auto-discover joining service)
  → GET /v1/info                           (gateways, auth methods, linker info)
  → POST /v1/join                          (agent key + identity claims)
  → POST /v1/join/{session}/verify         (if verification required)
  → GET /v1/join/{session}/provision     (membrane proof, linker URLs, bundle URL)
  → Install hApp, connect to network
```

All fields in the provision response are optional. A minimal deployment serving only membrane proofs returns just `membrane_proofs`. A gateway-only deployment returns only `http_gateways` from `/v1/info`.

## Status

Alpha implementation complete. Reference server, client library, and E2E tests are in `src/` and `test/`.
