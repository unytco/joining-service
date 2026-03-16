# Delegated Verification

Delegated verification allows trusted partner services to vouch for a user's identity, bypassing the normal challenge-response flow. The partner authenticates the user (e.g. via email code, OAuth) and then calls the joining service with proof that verification was completed.

## How It Works

1. User completes identity verification on the partner's service
2. Partner calls `POST /v1/join` with the user's `agent_key`, `claims`, and a `delegated_verification` payload
3. Partner authenticates via the `X-Partner-Api-Key` header
4. If valid, the session is created in `ready` state immediately — no challenges needed

## Configuration

Add a `delegated_verification` section to your config:

```json
{
  "happ": {
    "id": "my-happ",
    "name": "My hApp"
  },
  "auth_methods": ["delegated_verification"],
  "delegated_verification": {
    "trusted_partners": [
      {
        "partner_id": "my-partner",
        "name": "My Partner Service",
        "api_key_hash": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "allowed_claims": ["email"],
        "rate_limit": 100,
        "rate_limit_window_minutes": 60
      }
    ],
    "max_verification_age_hours": 24
  }
}
```

### Config Fields

| Field | Type | Description |
|-------|------|-------------|
| `trusted_partners` | array | List of authorized partner services |
| `trusted_partners[].partner_id` | string | Unique identifier for this partner (must be unique across all partners) |
| `trusted_partners[].name` | string | Human-readable partner name (for audit logs) |
| `trusted_partners[].api_key_hash` | string | SHA-256 hash of the partner's API key, prefixed with `sha256:` |
| `trusted_partners[].allowed_claims` | string[] | Which identity claims this partner can vouch for (e.g. `["email"]`) |
| `trusted_partners[].rate_limit` | number | Max requests per window (must be positive) |
| `trusted_partners[].rate_limit_window_minutes` | number | Rate limit window in minutes (must be positive) |
| `max_verification_age_hours` | number | How old a verification can be before it's rejected (default: 24) |

### Generating an API Key Hash

Generate the SHA-256 hash for a partner API key:

```bash
echo -n "my-secret-api-key" | sha256sum | awk '{print "sha256:" $1}'
```

On macOS (where `sha256sum` may not be available):

```bash
echo -n "my-secret-api-key" | shasum -a 256 | awk '{print "sha256:" $1}'
```

## API Usage

### Request

```http
POST /v1/join
Content-Type: application/json
X-Partner-Api-Key: my-secret-api-key

{
  "agent_key": "uhCAk...",
  "claims": {
    "email": "user@example.com"
  },
  "delegated_verification": {
    "partner_id": "my-partner",
    "verified_at": "2025-01-15T10:30:00Z",
    "verification_method": "email_code",
    "attested_claims": {
      "email": "user@example.com"
    },
    "reference_id": "optional-tracking-id"
  }
}
```

### Payload Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `partner_id` | string | yes | Must match the partner authenticated by the API key |
| `verified_at` | string | yes | ISO 8601 timestamp of when verification completed |
| `verification_method` | string | yes | How the partner verified the user (e.g. `email_code`, `oauth`) |
| `attested_claims` | object | recommended | Claims the partner actually verified — cross-checked against `body.claims` |
| `reference_id` | string | no | Optional tracking ID for audit correlation |

### Security: Claims Cross-Checking

The `attested_claims` field inside `delegated_verification` is cross-checked against the top-level `claims` object. If any attested claim value doesn't match the corresponding value in `claims`, the request is rejected with a 400 error (`claims_mismatch`).

This prevents a scenario where a caller with a valid API key substitutes different claims than what was actually verified.

### Response (Success)

```json
{
  "session": "abc123",
  "status": "ready"
}
```

The session is immediately `ready` — proceed to `GET /v1/join/{session}/provision`.

## Using with OR Groups

Delegated verification can be combined with other auth methods in an OR group:

```json
{
  "auth_methods": [
    { "any_of": ["email_code", "delegated_verification"] }
  ]
}
```

This lets users either verify directly via email or have a trusted partner vouch for them.
