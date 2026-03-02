# Joining Service Deployment Guide

Three deployment targets are supported, all using the same Hono application core:

| Target | Session store | Entry point | Use case |
|--------|--------------|-------------|----------|
| Local / manual | `memory` or `sqlite` | `src/server.ts` | Development, local testing |
| Cloudflare Workers | `cloudflare-kv` | Custom worker entry | Production edge |
| Edge node (Linux VPS) | `sqlite` | `dist/server.js` | Self-hosted production |

---

## Membrane proof signing key and DNA progenitor

This section is prerequisite reading before deploying with membrane proofs. Skip it only if your hApp uses `auth_methods: ["open"]` and does not require membrane proofs.

### The bootstrap ordering problem

The signing key is not an arbitrary key. The ed25519 public key derived from the seed must be embedded in the DNA's `properties` as the **progenitor** before the hApp bundle is compiled. The DNA's `genesis_self_check` Wasm callback validates every membrane proof by checking that its `signer_pub_key` field matches the progenitor embedded in the DNA at compile time.

The ordering constraint is:

```
1. Generate seed (once, offline)
2. Derive public key from seed
3. Embed public key as progenitor in DNA source
4. Build .happ bundle
5. Deploy joining service with the same seed
```

Steps 1–4 must happen before step 5. If the key is lost or rotated after the DNA is compiled, you must rebuild and redeploy the hApp.

### Generating the key pair

Run the script in this repo once, before building the hApp bundle:

```sh
npm run gen-signing-key
```

The script ([scripts/gen-signing-key.ts](scripts/gen-signing-key.ts)) uses `@holo-host/lair` to derive the key pair through the same libsodium path used by `LairProofGenerator` at runtime, so the public key is guaranteed to match. Once `@holo-host/lair` is published to npm as a normal package the `NODE_OPTIONS=--preserve-symlinks` workaround in the npm script can be dropped — no logic change to the script required.

Store the seed hex in a secrets manager (Vault, AWS Secrets Manager, 1Password, etc.) or a 600-permissioned file on the server. **Never commit it to version control.**

The `AgentPubKey` string (starting with `uhCAk`) goes into your DNA Rust source as the progenitor — typically in `dna.yaml` properties or hard-coded in `genesis_self_check`:

```yaml
# dna.yaml
properties:
  progenitor_pub_key: uhCAkXXXXXX...
```

or in Rust:

```rust
// integrity zome
use holochain_integrity_types::prelude::*;

#[hdk_extern]
pub fn genesis_self_check(data: GenesisSelfCheckData) -> ExternResult<ValidateCallbackResult> {
    let progenitor: AgentPubKey = AgentPubKey::try_from(
        "uhCAkXXXXXX..."  // same key from gen-signing-key output
    )?;
    // verify data.membrane_proof was signed by progenitor ...
}
```

After changing DNA properties the DNA hash changes, so all previously compiled bundles are invalidated.

---

## 1. Manual (local testing)

### Prerequisites

- Node.js 20+
- `npm install`

### Configuration file

Create a `config.json` in the project root. Minimum viable config (no membrane proofs):

```json
{
  "happ": {
    "id": "my-happ",
    "name": "My hApp",
    "happ_bundle_url": "http://localhost:8080/my-happ.happ"
  },
  "auth_methods": ["open"],
  "linker_urls": ["wss://linker.example.com:8090"]
}
```

With email-code auth and file transport (codes written to disk, not sent):

```json
{
  "happ": {
    "id": "my-happ",
    "name": "My hApp"
  },
  "auth_methods": ["email_code"],
  "linker_urls": ["wss://linker.example.com:8090"],
  "email": {
    "provider": "file",
    "output_dir": "./dev-emails"
  },
  "session": {
    "store": "sqlite",
    "db_path": "./dev-sessions.db"
  }
}
```

Email codes are written as `.txt` files under `./dev-emails/`. Open them to get the code.

With membrane proofs (dev — ephemeral key, NOT safe for production):

```json
{
  "happ": {
    "id": "my-happ",
    "name": "My hApp"
  },
  "auth_methods": ["open"],
  "linker_urls": ["wss://linker.example.com:8090"],
  "dna_hashes": ["uhC0k..."],
  "membrane_proof": {
    "enabled": true
  }
}
```

Omitting `signing_key_path` causes the server to generate an ephemeral key at startup. The ephemeral key changes on every restart, so proofs issued before a restart will not validate. Use this only in development against a throwaway network seed.

With membrane proofs (production — stable key):

```json
{
  "happ": {
    "id": "my-happ",
    "name": "My hApp"
  },
  "auth_methods": ["open"],
  "linker_urls": ["wss://linker.example.com:8090"],
  "dna_hashes": ["uhC0k..."],
  "dna_modifiers": {
    "network_seed": "my-happ-mainnet-2026"
  },
  "membrane_proof": {
    "enabled": true,
    "signing_key_path": "./signing-key.hex"
  }
}
```

The `signing_key_path` file must contain the 64-character hex seed generated in the key generation step above. See the [membrane proof section](#membrane-proof-signing-key-and-dna-progenitor) for how that key relates to your DNA.

### Run in dev mode (hot reload)

```sh
npm run dev -- config.json
# or with default path ./config.json:
npm run dev
```

The server starts on port `3000` (override with `"port"` in config).

### Run built output

```sh
npm run build
node dist/server.js config.json
```

### Verify it works

```sh
curl http://localhost:3000/.well-known/holo-joining
curl http://localhost:3000/v1/info
```

### Configuration reference

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `happ.id` | string | required | Machine-readable identifier |
| `happ.name` | string | required | Display name |
| `happ.happ_bundle_url` | string | — | URL clients use to fetch the .happ bundle |
| `auth_methods` | string[] | required | e.g. `["open"]`, `["email_code"]`, `["invite_code"]` |
| `linker_urls` | string[] | required | WebSocket URLs for the linker relay |
| `http_gateways` | array | — | Read-only gateway instances |
| `dna_hashes` | string[] | — | Required when `membrane_proof.enabled` is true |
| `dna_modifiers.network_seed` | string | — | DNA network seed |
| `membrane_proof.enabled` | boolean | false | Enable server-signed membrane proofs |
| `membrane_proof.signing_key_path` | string | — | Path to 64-char hex seed file. If absent, an ephemeral key is used. The public key derived from this seed **must match the progenitor embedded in the DNA**. |
| `email.provider` | `"postmark"` \| `"file"` | — | Required for `email_code` auth |
| `email.api_key` | string | — | Postmark server token |
| `email.from` | string | — | Sender address for Postmark |
| `email.output_dir` | string | `./dev-emails` | Directory for file transport output |
| `invite_codes` | string[] | — | Valid invite codes (for `invite_code` auth) |
| `session.store` | `"memory"` \| `"sqlite"` \| `"cloudflare-kv"` | `"memory"` | |
| `session.db_path` | string | `./sessions.db` | SQLite path (sqlite store only) |
| `session.pending_ttl_seconds` | number | 3600 | |
| `session.ready_ttl_seconds` | number | 86400 | |
| `linker_urls_expire_after_seconds` | number | 21600 | 6 hours |
| `reconnect.enabled` | boolean | true | Allow `POST /v1/reconnect` |
| `base_url` | string | auto-detected | Override for `/.well-known/holo-joining` response |
| `port` | number | 3000 | |

---

## 2. Cloudflare Workers

The app is built on Hono, which runs natively in the Workers runtime. Sessions are stored in Cloudflare KV.

### Prerequisites

- Cloudflare account with Workers and KV enabled
- Wrangler CLI: `npm install -g wrangler`
- `wrangler login`

### Create KV namespaces

```sh
wrangler kv namespace create SESSIONS
wrangler kv namespace create SESSIONS --preview
```

Note the namespace IDs printed; you will use them in `wrangler.toml`.

### wrangler.toml

Create `wrangler.toml` in the project root:

```toml
name = "joining-service"
main = "src/worker.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "SESSIONS"
id = "<your-production-kv-id>"
preview_id = "<your-preview-kv-id>"

[vars]
HAPP_ID = "my-happ"
HAPP_NAME = "My hApp"
HAPP_BUNDLE_URL = "https://app.example.com/my-happ.happ"
LINKER_URLS = '["wss://linker.example.com:8090"]'
AUTH_METHODS = '["open"]'
DNA_HASHES = '["uhC0k..."]'
BASE_URL = "https://joining.example.com/v1"
```

Secrets (never in `wrangler.toml`):

```sh
wrangler secret put POSTMARK_API_KEY
# The 64-char hex seed from gen-signing-key.mjs:
wrangler secret put MEMBRANE_PROOF_SIGNING_KEY
```

The `MEMBRANE_PROOF_SIGNING_KEY` secret must be the hex seed whose derived public key matches the progenitor embedded in your DNA. See the [membrane proof section](#membrane-proof-signing-key-and-dna-progenitor).

### Worker entry point

Create `src/worker.ts`:

```typescript
import { createApp, resolveConfig } from './index.js';
import { KvSessionStore } from './session/kv-store.js';
import { OpenAuthMethod } from './auth-methods/open.js';
import { EmailCodeAuthMethod } from './auth-methods/email-code.js';
import { PostmarkTransport } from './email/postmark.js';
import { LairProofGenerator } from './membrane-proof/lair-signer.js';

interface Env {
  SESSIONS: KVNamespace;
  HAPP_ID: string;
  HAPP_NAME: string;
  HAPP_BUNDLE_URL?: string;
  LINKER_URLS: string;           // JSON array string
  AUTH_METHODS: string;          // JSON array string
  DNA_HASHES?: string;           // JSON array string
  BASE_URL?: string;
  POSTMARK_API_KEY?: string;
  POSTMARK_FROM?: string;
  MEMBRANE_PROOF_SIGNING_KEY?: string;  // 64-char hex seed
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const linkerUrls: string[] = JSON.parse(env.LINKER_URLS);
    const authMethods: string[] = JSON.parse(env.AUTH_METHODS);
    const dnaHashes: string[] | undefined = env.DNA_HASHES
      ? JSON.parse(env.DNA_HASHES)
      : undefined;

    const config = resolveConfig({
      happ: {
        id: env.HAPP_ID,
        name: env.HAPP_NAME,
        happ_bundle_url: env.HAPP_BUNDLE_URL,
      },
      auth_methods: authMethods as any,
      linker_urls: linkerUrls,
      base_url: env.BASE_URL,
      dna_hashes: dnaHashes,
      membrane_proof: env.MEMBRANE_PROOF_SIGNING_KEY
        ? { enabled: true }
        : undefined,
      session: { store: 'cloudflare-kv' },
    });

    const sessionStore = new KvSessionStore(env.SESSIONS);

    const authPlugins = new Map();
    for (const method of authMethods) {
      if (method === 'open') {
        authPlugins.set('open', new OpenAuthMethod());
      } else if (method === 'email_code' && env.POSTMARK_API_KEY) {
        const transport = new PostmarkTransport(
          env.POSTMARK_API_KEY,
          env.POSTMARK_FROM ?? 'noreply@example.com',
        );
        authPlugins.set('email_code', new EmailCodeAuthMethod({ transport }));
      }
    }

    let proofGenerator;
    if (env.MEMBRANE_PROOF_SIGNING_KEY) {
      proofGenerator = await LairProofGenerator.fromHex(env.MEMBRANE_PROOF_SIGNING_KEY);
    }

    const app = createApp({ config, sessionStore, authPlugins, proofGenerator });
    return app.fetch(request);
  },
};
```

### Deploy

```sh
# Preview (local Miniflare emulation)
wrangler dev

# Production deploy
wrangler deploy
```

### Custom domain

In the Cloudflare dashboard: Workers & Pages → your worker → Settings → Domains & Routes → add a custom domain or route pattern.

Or via `wrangler.toml`:

```toml
[[routes]]
pattern = "joining.example.com/*"
zone_name = "example.com"
```

### Workers-specific constraints

- **No filesystem.** `membrane_proof.signing_key_path` is not available; pass the hex seed as the `MEMBRANE_PROOF_SIGNING_KEY` secret instead.
- **No SQLite.** Use `session.store: "cloudflare-kv"`.
- **KV consistency.** KV is eventually consistent. Under high concurrent join load, two requests for the same agent key may race and create duplicate pending sessions. This is harmless: one will be overwritten. Ready sessions are not affected.

---

## 3. Edge node (self-hosted Linux VPS)

Standard Node.js deployment behind a reverse proxy.

### Prerequisites

- Node.js 20+
- Process supervisor (systemd)
- nginx or Caddy for TLS termination

### Build

```sh
npm install
npm run build
```

Output goes to `dist/`.

### Configuration file

Use the same JSON format as the local setup. For production:

- `session.store: "sqlite"` with a durable `db_path` (not in `/tmp`)
- `email.provider: "postmark"` with a real API key
- `membrane_proof.signing_key_path` pointing to a persistent file

The `signing_key_path` file must contain the same hex seed used to derive the progenitor key that was embedded in the DNA when the hApp bundle was compiled. See the [membrane proof section](#membrane-proof-signing-key-and-dna-progenitor).

Example `/etc/joining-service/config.json`:

```json
{
  "happ": {
    "id": "my-happ",
    "name": "My hApp",
    "happ_bundle_url": "https://app.example.com/my-happ.happ"
  },
  "auth_methods": ["email_code"],
  "linker_urls": ["wss://linker.example.com:8090"],
  "http_gateways": [
    {
      "url": "https://gw.example.com",
      "dna_hashes": ["uhC0k..."],
      "status": "available"
    }
  ],
  "dna_hashes": ["uhC0k..."],
  "dna_modifiers": {
    "network_seed": "my-happ-mainnet-2026"
  },
  "membrane_proof": {
    "enabled": true,
    "signing_key_path": "/etc/joining-service/signing-key.hex"
  },
  "email": {
    "provider": "postmark",
    "api_key": "YOUR_POSTMARK_TOKEN",
    "from": "join@example.com"
  },
  "session": {
    "store": "sqlite",
    "db_path": "/var/lib/joining-service/sessions.db"
  },
  "base_url": "https://joining.example.com/v1",
  "port": 3000
}
```

### Install the signing key file

The key was generated in the [membrane proof section](#membrane-proof-signing-key-and-dna-progenitor). Copy it to the server securely:

```sh
# Copy from your secrets manager or local machine
echo "<64-char-hex-seed>" > /etc/joining-service/signing-key.hex
chmod 600 /etc/joining-service/signing-key.hex
chown joining-service:joining-service /etc/joining-service/signing-key.hex
```

Do not regenerate this key on the server — use the same key that was embedded in the compiled DNA.

### systemd unit

`/etc/systemd/system/joining-service.service`:

```ini
[Unit]
Description=Holo Joining Service
After=network.target

[Service]
Type=simple
User=joining-service
Group=joining-service
WorkingDirectory=/opt/joining-service
ExecStart=/usr/bin/node dist/server.js /etc/joining-service/config.json
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/joining-service /etc/joining-service

[Install]
WantedBy=multi-user.target
```

```sh
useradd --system --no-create-home joining-service
mkdir -p /var/lib/joining-service
chown joining-service:joining-service /var/lib/joining-service

# Install app files
mkdir -p /opt/joining-service
cp -r dist package.json /opt/joining-service/
cd /opt/joining-service && npm install --omit=dev

systemctl daemon-reload
systemctl enable --now joining-service
systemctl status joining-service
```

### nginx reverse proxy with TLS

`/etc/nginx/sites-available/joining-service`:

```nginx
server {
    listen 443 ssl http2;
    server_name joining.example.com;

    ssl_certificate     /etc/letsencrypt/live/joining.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/joining.example.com/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name joining.example.com;
    return 301 https://$host$request_uri;
}
```

```sh
ln -s /etc/nginx/sites-available/joining-service /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d joining.example.com
```

### Deploying the `.well-known` discovery endpoint

The `/.well-known/holo-joining` endpoint must be served from the **hApp UI domain** (the origin users load in their browser), not necessarily from the joining service domain. The simplest approach is a static JSON file on the app's web server.

nginx on the app domain:

```nginx
location = /.well-known/holo-joining {
    alias /var/www/app/.well-known/holo-joining.json;
    default_type application/json;
    add_header Access-Control-Allow-Origin *;
    add_header Cache-Control "public, max-age=3600";
}
```

`/var/www/app/.well-known/holo-joining.json`:

```json
{
  "joining_service_url": "https://joining.example.com/v1",
  "happ_id": "my-happ",
  "version": "1.0"
}
```

If the joining service runs on the same domain as the hApp UI (same nginx vhost), the built-in `GET /.well-known/holo-joining` handler covers this without extra configuration.

### Verify the deployment

```sh
curl https://joining.example.com/.well-known/holo-joining
curl https://joining.example.com/v1/info
```

### Updates

```sh
npm run build
rsync -a dist/ server:/opt/joining-service/dist/
ssh server systemctl restart joining-service
```

---

## Signing key operational notes

### Key rotation

The signing key is baked into the compiled DNA. Changing the key requires:

1. Generating a new seed (see above)
2. Changing the progenitor in the DNA source
3. Rebuilding and redeploying the hApp bundle
4. Updating the joining service config to use the new seed

There is no in-place rotation. Agents who joined under the old DNA hash and membrane proof remain valid on the DHT (membrane proofs are committed at genesis and do not need re-validation). Agents joining after the new bundle is deployed will receive proofs signed by the new key, validated by the new DNA.

### Multiple deployment targets with the same DNA

If you deploy the joining service to both Cloudflare Workers and a VPS (e.g. active/passive failover), both deployments must use the **same seed hex** and must serve the same `linker_urls`. The DNA has one progenitor; both services sign proofs with the same key.

### Backing up the key

| Environment | Backup method |
|-------------|---------------|
| Edge node | Store seed hex in a secrets manager (Vault, AWS Secrets Manager, etc.) and/or encrypted offline backup |
| Cloudflare Workers | The Wrangler secret is stored by Cloudflare; export the hex seed from your secrets manager as the source of truth |
| Local dev | Ephemeral key — no backup needed |
