import { createApp, type ServiceContext } from '../src/app.js';
import { resolveConfig, type ServiceConfig } from '../src/config.js';
import { MemorySessionStore } from '../src/session/memory-store.js';
import { SqliteSessionStore } from '../src/session/sqlite-store.js';
import type { SessionStore } from '../src/session/store.js';
import { OpenAuthMethod } from '../src/auth-methods/open.js';
import { EmailCodeAuthMethod } from '../src/auth-methods/email-code.js';
import { InviteCodeAuthMethod } from '../src/auth-methods/invite-code.js';
import { FileTransport } from '../src/email/file.js';
import { Ed25519ProofGenerator } from '../src/membrane-proof/ed25519-signer.js';
import type { AuthMethodPlugin } from '../src/auth-methods/plugin.js';
import type { Hono } from 'hono';

// A minimal valid 39-byte AgentPubKey, base64-encoded.
// Prefix 0x84,0x20,0x24 + 32 bytes of key + 4 bytes of DHT location
export function fakeAgentKey(seed = 0): string {
  const bytes = new Uint8Array(39);
  bytes[0] = 0x84;
  bytes[1] = 0x20;
  bytes[2] = 0x24;
  // Fill remaining with deterministic data
  for (let i = 3; i < 39; i++) {
    bytes[i] = (seed + i) & 0xff;
  }
  return Buffer.from(bytes).toString('base64');
}

export interface TestApp {
  app: Hono;
  ctx: ServiceContext;
  request: (path: string, init?: RequestInit) => Promise<Response>;
}

export async function createTestApp(
  configOverrides: Partial<ServiceConfig> = {},
  pluginOverrides?: Map<string, AuthMethodPlugin>,
): Promise<TestApp> {
  const defaults: Partial<ServiceConfig> = {
    happ: {
      id: 'test-app',
      name: 'Test App',
      happ_bundle_url: 'https://example.com/test.happ',
    },
    auth_methods: ['open'],
    linker_urls: ['wss://linker.example.com:8090'],
    session: { store: 'memory', pending_ttl_seconds: 3600, ready_ttl_seconds: 86400 },
  };

  const merged = { ...defaults, ...configOverrides };
  // Merge happ fields
  if (configOverrides.happ) {
    merged.happ = { ...defaults.happ, ...configOverrides.happ };
  }

  const config = resolveConfig(merged);

  let sessionStore: SessionStore;
  if (config.session!.store === 'sqlite') {
    sessionStore = new SqliteSessionStore(
      config.session!.db_path ?? ':memory:',
      config.session!.pending_ttl_seconds,
      config.session!.ready_ttl_seconds,
    );
  } else {
    sessionStore = new MemorySessionStore(
      config.session!.pending_ttl_seconds,
      config.session!.ready_ttl_seconds,
    );
  }

  let authPlugins: Map<string, AuthMethodPlugin>;
  if (pluginOverrides) {
    authPlugins = pluginOverrides;
  } else {
    authPlugins = new Map();
    for (const method of config.auth_methods) {
      switch (method) {
        case 'open':
          authPlugins.set('open', new OpenAuthMethod());
          break;
        case 'email_code': {
          const transport = new FileTransport(
            config.email?.output_dir ?? '/tmp/test-emails',
          );
          authPlugins.set(
            'email_code',
            new EmailCodeAuthMethod({ transport }),
          );
          break;
        }
        case 'invite_code':
          authPlugins.set(
            'invite_code',
            new InviteCodeAuthMethod(config.invite_codes ?? []),
          );
          break;
      }
    }
  }

  let proofGenerator: Ed25519ProofGenerator | undefined;
  if (config.membrane_proof?.enabled) {
    const { privateKey } = await Ed25519ProofGenerator.generateKeyPair();
    proofGenerator = new Ed25519ProofGenerator(privateKey);
  }

  const ctx: ServiceContext = {
    config,
    sessionStore,
    authPlugins,
    proofGenerator,
  };

  const app = createApp(ctx);

  const request = (path: string, init?: RequestInit) =>
    app.request(path, init);

  return { app, ctx, request };
}
