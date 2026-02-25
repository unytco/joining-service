# Holo Joining Service API Specification

**Version**: 1.0.0-draft
**Date**: 2026-02-24
**Status**: Design specification

## Overview

The Joining Service is a per-hApp REST API that brokers the onboarding flow for users of Holochain apps running in the Holo Web Conductor (HWC) browser extension. It centralizes the configuration that HWC clients need to participate in a Holochain network: linker URLs, optional membrane proofs, hApp bundle locations, and identity verification flows.

Each hApp developer runs their own joining service (or uses a hosted one). The HWC client library auto-discovers it via `.well-known/holo-joining` on the app domain.

### User Flow Summary

```
1. User loads web page
2. Extension auto-detected (or download prompted)
3. Client discovers joining service via .well-known
4. GET /v1/info → R/O gateway URLs (optional browse-before-join)
5. Extension generates agent key
6. POST /v1/join → session + challenges (if any)
7. User completes verification challenges (if any)
8. GET /v1/join/{session}/credentials → linker URLs, membrane proof, hApp bundle URL
9. Client installs hApp with credentials
10. Standard hApp UI operates
```

---

## 1. Base URL and Versioning

The API is versioned via URL path prefix:

```
https://app.example.com/.well-known/holo-joining   (discovery)
https://joining.example.com/v1/info                 (API endpoints)
https://joining.example.com/v1/join                 (API endpoints)
```

The discovery endpoint returns the versioned base URL. Clients resolve it from `.well-known` and never hardcode the API path.

All responses include the header:
```
X-Joining-Service-Version: 1.0
```

---

## 2. Auto-Discovery

### `GET /.well-known/holo-joining`

Served from the **app domain** (the domain where the hApp UI is hosted). Returns a pointer to the joining service.

**Response** (`200 OK`):
```json
{
  "joining_service_url": "https://joining.example.com/v1",
  "happ_id": "mewsfeed",
  "version": "1.0"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `joining_service_url` | string (URL) | yes | Base URL for the joining service API (includes version prefix) |
| `happ_id` | string | yes | Identifier for this hApp (used for logging/routing, not cryptographic) |
| `version` | string | yes | Version of the well-known format (`"1.0"`) |

**Headers**:
- `Content-Type: application/json`
- `Access-Control-Allow-Origin: *`
- `Cache-Control: public, max-age=3600`

If the file does not exist, the client falls back to manual configuration (developer passes `linkerUrl` directly, as is done today).

---

## 3. Endpoints

### 3.1 `GET /v1/info` — Service Info

Returns hApp metadata, available read-only gateways, supported auth methods, and linker information. **Unauthenticated** — anyone loading the page can call this.

**Response** (`200 OK`):
```json
{
  "happ": {
    "id": "mewsfeed",
    "name": "Mewsfeed",
    "description": "Decentralized microblogging on Holochain",
    "icon_url": "https://app.example.com/icon.png"
  },
  "http_gateways": [
    {
      "url": "https://gw1.example.com",
      "dna_hashes": ["uhC0k..."],
      "status": "available"
    }
  ],
  "auth_methods": ["open", "email_code", "evm_signature"],
  "linker_info": {
    "selection_mode": "assigned",
    "region_hints": ["us-east", "eu-west"]
  },
  "happ_bundle_url": "https://app.example.com/mewsfeed.happ",
  "dna_modifiers": {
    "network_seed": "mewsfeed-mainnet-2026",
    "properties": {}
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `happ.id` | string | yes | Machine-readable hApp identifier |
| `happ.name` | string | yes | Human-readable name |
| `happ.description` | string | no | Short description |
| `happ.icon_url` | string (URL) | no | Icon for display in extension popup |
| `http_gateways` | array | no | Available hc-http-gw instances for read-only access before joining |
| `http_gateways[].url` | string (URL) | yes | Gateway base URL |
| `http_gateways[].dna_hashes` | string[] | yes | Base64-encoded DNA hashes served by this gateway |
| `http_gateways[].status` | string | yes | `"available"`, `"degraded"`, or `"offline"` |
| `auth_methods` | string[] | yes | Supported authentication methods (see Section 7) |
| `linker_info.selection_mode` | string | yes | `"assigned"` (server picks linker) or `"client_choice"` (client picks from list) |
| `linker_info.region_hints` | string[] | no | Available regions for latency optimization |
| `happ_bundle_url` | string (URL) | no | URL to download the .happ bundle. May be absent if gated behind auth. |
| `dna_modifiers` | object | no | DNA modifiers to apply during installation |
| `dna_modifiers.network_seed` | string | no | Network seed for DNA hash computation |
| `dna_modifiers.properties` | object | no | DNA properties (arbitrary JSON, msgpack-encoded by client) |

---

### 3.2 `POST /v1/join` — Initiate Join

The client sends its agent key and optional identity claims. The server determines what verification (if any) is required.

**Request**:
```json
{
  "agent_key": "uhCAk...",
  "claims": {
    "email": "user@example.com"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent_key` | string | yes | Base64-encoded 39-byte AgentPubKey (from `encodeHashToBase64()`) |
| `claims` | object | no | Identity claims for verification |
| `claims.email` | string | no | Email address |
| `claims.phone` | string | no | Phone number (E.164 format) |
| `claims.evm_address` | string | no | EVM wallet address (0x-prefixed, checksummed) |
| `claims.solana_address` | string | no | Solana wallet address (base58) |
| `claims.invite_code` | string | no | Pre-issued invite code |

**Response** (`201 Created`) — verification required:
```json
{
  "session": "js_a1b2c3d4e5f6",
  "status": "pending",
  "challenges": [
    {
      "id": "ch_email_1",
      "type": "email_code",
      "description": "Enter the 6-digit code sent to u***@example.com",
      "expires_at": "2026-02-24T12:30:00Z"
    }
  ],
  "poll_interval_ms": 2000
}
```

**Response** (`201 Created`) — open join, ready immediately:
```json
{
  "session": "js_x9y8z7w6",
  "status": "ready"
}
```

**Response** (`201 Created`) — rejected:
```json
{
  "session": "js_r1r2r3",
  "status": "rejected",
  "reason": "This hApp requires an invite code"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `session` | string | yes | Opaque session token (prefixed `js_`) |
| `status` | string | yes | `"ready"`, `"pending"`, or `"rejected"` |
| `challenges` | array | if pending | Verification challenges to complete |
| `challenges[].id` | string | yes | Challenge identifier (used in verify endpoint) |
| `challenges[].type` | string | yes | Challenge type (matches `auth_methods` values) |
| `challenges[].description` | string | yes | Human-readable instruction for the user |
| `challenges[].expires_at` | string (ISO 8601) | no | When this challenge expires |
| `challenges[].metadata` | object | no | Type-specific data (e.g., EVM signing payload) |
| `reason` | string | if rejected | Human-readable rejection reason |
| `poll_interval_ms` | number | if pending | Suggested polling interval in milliseconds |

**Errors**:

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 400 | `invalid_agent_key` | Agent key is not valid base64 or not 39 bytes |
| 400 | `missing_claims` | Required claims for this hApp's auth method were not provided |
| 409 | `agent_already_joined` | This agent key has already completed joining |
| 429 | `rate_limited` | Too many join attempts |

---

### 3.3 `POST /v1/join/{session}/verify` — Submit Verification

Submit verification responses for pending challenges.

**Request**:
```json
{
  "challenge_id": "ch_email_1",
  "response": "482916"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `challenge_id` | string | yes | Challenge ID from the join response |
| `response` | string | yes | Verification response (code, signature, etc.) |

For EVM signature challenges, `response` is the hex-encoded signature:
```json
{
  "challenge_id": "ch_evm_1",
  "response": "0x1234abcd..."
}
```

**Response** (`200 OK`) — challenge passed, more remain:
```json
{
  "status": "pending",
  "challenges_remaining": [
    {
      "id": "ch_sms_1",
      "type": "sms_code",
      "description": "Enter the 6-digit code sent to +1***4567",
      "expires_at": "2026-02-24T12:35:00Z"
    }
  ],
  "poll_interval_ms": 2000
}
```

**Response** (`200 OK`) — all challenges complete:
```json
{
  "status": "ready"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | yes | `"ready"`, `"pending"`, or `"rejected"` |
| `challenges_remaining` | array | if pending | Remaining challenges |
| `reason` | string | if rejected | Rejection reason (e.g., wrong code too many times) |
| `poll_interval_ms` | number | if pending | Suggested polling interval |

**Errors**:

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 400 | `invalid_response` | Response format is wrong for this challenge type |
| 401 | `invalid_session` | Session token is invalid or expired |
| 404 | `challenge_not_found` | Challenge ID not found for this session |
| 410 | `challenge_expired` | Challenge has expired; client should `POST /join` again |
| 422 | `verification_failed` | Response was incorrect (e.g., wrong code) |
| 429 | `rate_limited` | Too many verification attempts |

---

### 3.4 `GET /v1/join/{session}/status` — Poll Status

Poll for the current status of a join session. Used when external processes (e.g., admin approval, async KYC) may change the status without client action.

**Response** (`200 OK`):
```json
{
  "status": "pending",
  "challenges": [
    {
      "id": "ch_email_1",
      "type": "email_code",
      "description": "Enter the 6-digit code sent to u***@example.com",
      "completed": false
    }
  ],
  "poll_interval_ms": 2000
}
```

Same response shape as the join response.

**Errors**:

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 401 | `invalid_session` | Session token is invalid or expired |
| 410 | `session_expired` | Session has expired entirely |

---

### 3.5 `GET /v1/join/{session}/credentials` — Get Credentials

Retrieve the credentials needed to connect to the Holochain network. Only available when session status is `"ready"`.

**Response** (`200 OK`):
```json
{
  "linker_urls": [
    "wss://linker1.example.com:8090",
    "wss://linker2.example.com:8090"
  ],
  "membrane_proof": "gqNPa6RkYXRh...",
  "happ_bundle_url": "https://app.example.com/mewsfeed.happ",
  "dna_modifiers": {
    "network_seed": "mewsfeed-mainnet-2026",
    "properties": {}
  },
  "expires_at": "2026-02-25T12:00:00Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `linker_urls` | string[] | yes | Ordered list of linker WebSocket URLs (client tries in order) |
| `membrane_proof` | string | no | Base64-encoded msgpack bytes. Null/absent if hApp has no membrane requirement. |
| `happ_bundle_url` | string (URL) | no | URL to fetch the .happ bundle. May differ from `/info` response (gated behind auth). |
| `dna_modifiers` | object | no | DNA modifiers to apply during installation |
| `dna_modifiers.network_seed` | string | no | Network seed |
| `dna_modifiers.properties` | object | no | DNA properties (JSON; client encodes to msgpack) |
| `expires_at` | string (ISO 8601) | no | When these credentials expire (client should re-join) |

**Errors**:

| HTTP Status | Code | Description |
|-------------|------|-------------|
| 401 | `invalid_session` | Session token is invalid or expired |
| 403 | `not_ready` | Session exists but status is not `"ready"` |
| 410 | `session_expired` | Session has expired; must start over |

---

## 4. Error Response Format

All errors follow a consistent JSON structure:

```json
{
  "error": {
    "code": "invalid_agent_key",
    "message": "Agent key must be a valid base64-encoded 39-byte HoloHash",
    "details": {}
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `error.code` | string | yes | Machine-readable error code (snake_case) |
| `error.message` | string | yes | Human-readable description |
| `error.details` | object | no | Additional type-specific context |

**Standard HTTP status codes**:
- `400` — Bad request (malformed input)
- `401` — Unauthorized (invalid/expired session)
- `403` — Forbidden (session not in correct state)
- `404` — Not found
- `409` — Conflict (duplicate agent)
- `410` — Gone (expired resource)
- `422` — Unprocessable entity (verification failed)
- `429` — Too many requests
- `500` — Internal server error

---

## 5. CORS and Rate Limiting

### CORS

The joining service must be callable from any origin (hApp UIs on arbitrary domains):

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
Access-Control-Max-Age: 86400
```

Session tokens are passed in the URL path (`/join/{session}/...`), not in headers. This avoids preflight request complications for simple GET/POST calls.

### Rate Limiting

Rate limit headers on every response:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
X-RateLimit-Reset: 1708776000
Retry-After: 30
```

Recommended limits:

| Endpoint | Limit | Scope |
|----------|-------|-------|
| `GET /v1/info` | 120/min | per IP |
| `POST /v1/join` | 10/min | per IP |
| `POST /v1/join/{session}/verify` | 5/min | per session |
| `GET /v1/join/{session}/credentials` | 30/min | per session |
| `GET /v1/join/{session}/status` | 30/min | per session |

---

## 6. Security Considerations

### Session Scoping
- Each session is bound to the `agent_key` that created it. Credentials are only issued for that agent.
- Session tokens: cryptographically random, at least 128 bits of entropy, prefixed `js_`.
- Expiry: 1 hour for pending sessions, 24 hours for ready sessions.

### Agent Key Validation
- Server validates that `agent_key` decodes to exactly 39 bytes and starts with the AgentPubKey type prefix (`0x84, 0x20, 0x24`).
- The server does NOT verify private key ownership — that proof happens at the Holochain network level during genesis and all subsequent signed actions.

### Membrane Proof Integrity
- Generated server-side, typically includes agent key + timestamp + server signature.
- Opaque to the client (msgpack bytes, base64 for transport).
- Validated by the DNA's `genesis_self_check` callback.

### Transport Security
- All endpoints must be served over HTTPS.
- The `.well-known` endpoint must be on the same origin as the hApp UI (prevents MITM redirection).

### Rate Limiting Rationale
- `POST /join` is aggressive (10/min) because each join may trigger email/SMS sends.
- Verification attempts limited per session to prevent brute-force of codes.

---

## 7. Authentication Methods Reference

| Method | Claims Required | Challenge Type | Response Format | Notes |
|--------|----------------|----------------|-----------------|-------|
| `open` | none | none | N/A | Instant `"ready"` status |
| `email_code` | `email` | 6-digit code via email | numeric string | Code masked in description |
| `sms_code` | `phone` | 6-digit code via SMS | numeric string | Phone masked in description |
| `evm_signature` | `evm_address` | Sign message | hex signature `0x...` | Signing payload in `metadata` |
| `solana_signature` | `solana_address` | Sign message | base58 signature | Signing payload in `metadata` |
| `invite_code` | `invite_code` | none | N/A | Validated at join time |
| `x-*` | custom | custom | custom | Developer-defined methods |

### EVM Signature Challenge Metadata

```json
{
  "metadata": {
    "sign_method": "personal_sign",
    "message": "Join mewsfeed with agent uhCAk...\nNonce: x7y8z9\nTimestamp: 2026-02-24T12:00:00Z"
  }
}
```

The client uses ethers.js, viem, or wallet API to sign the message and returns the hex signature.

---

## 8. Example Flows

### 8.1 Open Join (no verification)

```
Client                                      Joining Service
  │                                              │
  ├─ GET /.well-known/holo-joining ────────────► │
  │◄─ { joining_service_url } ───────────────────┤
  │                                              │
  ├─ GET /v1/info ───────────────────────────────►│
  │◄─ { auth_methods: ["open"], ... } ───────────┤
  │                                              │
  ├─ POST /v1/join { agent_key } ────────────────►│
  │◄─ { session, status: "ready" } ──────────────┤
  │                                              │
  ├─ GET /v1/join/{session}/credentials ─────────►│
  │◄─ { linker_urls, happ_bundle_url } ──────────┤
  │                                              │
  ├─ [fetch hApp bundle, install, connect] ──────►│
```

### 8.2 Email Verification

```
Client                                      Joining Service
  │                                              │
  ├─ GET /v1/info ───────────────────────────────►│
  │◄─ { auth_methods: ["email_code"] } ──────────┤
  │                                              │
  ├─ POST /v1/join                               │
  │  { agent_key, claims: { email } } ──────────►│
  │◄─ { session, status: "pending",              │
  │     challenges: [{ id, type: "email_code",   │
  │       description: "Enter code..." }] } ─────┤
  │                                              │
  │  (user checks email, gets code 482916)       │
  │                                              │
  ├─ POST /v1/join/{session}/verify              │
  │  { challenge_id, response: "482916" } ──────►│
  │◄─ { status: "ready" } ───────────────────────┤
  │                                              │
  ├─ GET /v1/join/{session}/credentials ─────────►│
  │◄─ { linker_urls, membrane_proof } ───────────┤
```

### 8.3 EVM Wallet Signing

```
Client                                      Joining Service
  │                                              │
  ├─ POST /v1/join                               │
  │  { agent_key, claims: { evm_address } } ────►│
  │◄─ { session, status: "pending",              │
  │     challenges: [{ id, type: "evm_signature",│
  │       metadata: { sign_method, message } }] }┤
  │                                              │
  │  (user signs with MetaMask/wallet)           │
  │                                              │
  ├─ POST /v1/join/{session}/verify              │
  │  { challenge_id, response: "0x1a2b..." } ───►│
  │◄─ { status: "ready" } ───────────────────────┤
  │                                              │
  ├─ GET /v1/join/{session}/credentials ─────────►│
  │◄─ { linker_urls, membrane_proof } ───────────┤
```

### 8.4 Read-Only Gateway Before Join

```
Client                                      Joining Service
  │                                              │
  ├─ GET /v1/info ───────────────────────────────►│
  │◄─ { http_gateways: [{ url, dna_hashes }] } ─┤
  │                                              │
  ├─ [route zome calls to http_gateways[0].url] ─►  hc-http-gw
  │◄─ [read-only results] ───────────────────────┤
  │                                              │
  │  (user decides to join)                      │
  │                                              │
  ├─ POST /v1/join { agent_key } ────────────────►│
  │  ... (normal join flow) ...                  │
  │                                              │
  ├─ [switch from http-gw to local WASM via linker]
```

### 8.5 Multi-Step Verification (Email + KYC)

```
Client                                      Joining Service
  │                                              │
  ├─ POST /v1/join { agent_key, claims: { email } }
  │◄─ { session, status: "pending",              │
  │     challenges: [                            │
  │       { id: "ch_email_1", type: "email_code" },
  │       { id: "ch_kyc_1", type: "x-kyc-review" }
  │     ] } ─────────────────────────────────────┤
  │                                              │
  ├─ POST /v1/join/{session}/verify              │
  │  { challenge_id: "ch_email_1", response: "482916" }
  │◄─ { status: "pending",                      │
  │     challenges_remaining: [                  │
  │       { id: "ch_kyc_1", type: "x-kyc-review",
  │         description: "Awaiting admin review" }
  │     ] } ─────────────────────────────────────┤
  │                                              │
  │  (poll while waiting for admin approval)     │
  ├─ GET /v1/join/{session}/status ──────────────►│
  │◄─ { status: "pending" } ─────────────────────┤
  │  ... (repeat polling) ...                    │
  ├─ GET /v1/join/{session}/status ──────────────►│
  │◄─ { status: "ready" } ───────────────────────┤
  │                                              │
  ├─ GET /v1/join/{session}/credentials ─────────►│
  │◄─ { linker_urls, membrane_proof } ───────────┤
```

---

## 9. TypeScript Type Definitions

These types define the API contract for client implementations:

```typescript
// --- Discovery ---

interface WellKnownHoloJoining {
  joining_service_url: string;
  happ_id: string;
  version: string;
}

// --- /v1/info ---

interface JoiningServiceInfo {
  happ: {
    id: string;
    name: string;
    description?: string;
    icon_url?: string;
  };
  http_gateways?: HttpGateway[];
  auth_methods: AuthMethod[];
  linker_info: {
    selection_mode: 'assigned' | 'client_choice';
    region_hints?: string[];
  };
  happ_bundle_url?: string;
  dna_modifiers?: DnaModifiers;
}

interface HttpGateway {
  url: string;
  dna_hashes: string[];
  status: 'available' | 'degraded' | 'offline';
}

type AuthMethod =
  | 'open'
  | 'email_code'
  | 'sms_code'
  | 'evm_signature'
  | 'solana_signature'
  | 'invite_code'
  | `x-${string}`;

interface DnaModifiers {
  network_seed?: string;
  properties?: Record<string, unknown>;
}

// --- /v1/join ---

interface JoinRequest {
  agent_key: string;
  claims?: Record<string, string>;
}

interface JoinResponse {
  session: string;
  status: 'ready' | 'pending' | 'rejected';
  challenges?: Challenge[];
  reason?: string;
  poll_interval_ms?: number;
}

interface Challenge {
  id: string;
  type: AuthMethod;
  description: string;
  expires_at?: string;
  metadata?: Record<string, unknown>;
  completed?: boolean;
}

// --- /v1/join/{session}/verify ---

interface VerifyRequest {
  challenge_id: string;
  response: string;
}

interface VerifyResponse {
  status: 'ready' | 'pending' | 'rejected';
  challenges_remaining?: Challenge[];
  reason?: string;
  poll_interval_ms?: number;
}

// --- /v1/join/{session}/credentials ---

interface JoinCredentials {
  linker_urls: string[];
  membrane_proof?: string;
  happ_bundle_url?: string;
  dna_modifiers?: DnaModifiers;
  expires_at?: string;
}

// --- Errors ---

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
```
