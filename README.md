# Holo Joining Service

Standardized REST API for onboarding users to Holochain apps running in the Holo Web Conductor (HWC) browser extension.

## What This Is

A per-hApp service that brokers the data HWC needs to connect a new user to a Holochain network:

- **Linker URLs** — relay servers connecting browser nodes to the network
- **Membrane proofs** — cryptographic authorization to join (optional, per-hApp)
- **hApp bundles** — the application WASM and manifest
- **HTTP gateways** — read-only access before the user has joined

## Documents

- [JOINING_SERVICE_API.md](./JOINING_SERVICE_API.md) — Full REST API specification
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) — Phased plan for client library, extension, and reference server

## Quick Summary

```
User loads page
  → GET /.well-known/holo-joining         (auto-discover joining service)
  → GET /v1/info                           (R/O gateways, auth methods)
  → POST /v1/join                          (agent key + identity claims)
  → POST /v1/join/{session}/verify         (if verification required)
  → GET /v1/join/{session}/credentials     (linker URLs, membrane proof)
  → Install hApp, connect to network
```

## Status

Design phase. API specification is draft. No implementation yet.
