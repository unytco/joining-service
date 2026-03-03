/**
 * E2E test helpers — spin up a real HTTP server backed by the joining service.
 */
import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { createApp, type ServiceContext } from '../../src/app.js';
import { resolveConfig, type ServiceConfig } from '../../src/config.js';
import { MemorySessionStore } from '../../src/session/memory-store.js';
import { OpenAuthMethod } from '../../src/auth-methods/open.js';
import { EmailCodeAuthMethod } from '../../src/auth-methods/email-code.js';
import { InviteCodeAuthMethod } from '../../src/auth-methods/invite-code.js';
import { AgentWhitelistAuthMethod } from '../../src/auth-methods/agent-whitelist.js';
import { FileTransport } from '../../src/email/file.js';
import { LairProofGenerator } from '../../src/membrane-proof/lair-signer.js';
import { StaticUrlProvider } from '../../src/urls/static.js';
import { randomBytes } from 'node:crypto';
import type { AuthMethodPlugin } from '../../src/auth-methods/plugin.js';
import type { AuthMethod } from '../../src/types.js';
import type http from 'node:http';

export interface E2EServer {
  baseUrl: string;
  ctx: ServiceContext;
  close: () => Promise<void>;
}

const DEFAULT_CONFIG: Partial<ServiceConfig> = {
  happ: {
    id: 'e2e-test-app',
    name: 'E2E Test App',
    happ_bundle_url: 'https://example.com/test.happ',
  },
  auth_methods: ['open'],
  session: { store: 'memory', pending_ttl_seconds: 3600, ready_ttl_seconds: 86400 },
};

export async function startE2EServer(
  configOverrides: Partial<ServiceConfig> = {},
): Promise<E2EServer> {
  const merged = { ...DEFAULT_CONFIG, ...configOverrides };
  if (configOverrides.happ) {
    merged.happ = { ...DEFAULT_CONFIG.happ, ...configOverrides.happ };
  }

  // Force port 0 so the OS assigns a free port
  merged.port = 0;

  const config = resolveConfig(merged);

  const sessionStore = new MemorySessionStore(
    config.session!.pending_ttl_seconds,
    config.session!.ready_ttl_seconds,
  );

  // Flatten AuthMethodEntry[] to unique method names (handles { any_of: [...] } groups)
  const authPlugins = new Map<string, AuthMethodPlugin>();
  const methods = new Set<AuthMethod>();
  for (const entry of config.auth_methods) {
    if (typeof entry === 'object' && 'any_of' in entry) {
      for (const m of entry.any_of) methods.add(m);
    } else {
      methods.add(entry as AuthMethod);
    }
  }
  for (const method of methods) {
    switch (method) {
      case 'open':
        authPlugins.set('open', new OpenAuthMethod());
        break;
      case 'email_code': {
        const transport = new FileTransport(
          config.email?.output_dir ?? '/tmp/e2e-test-emails',
        );
        authPlugins.set('email_code', new EmailCodeAuthMethod({ transport }));
        break;
      }
      case 'invite_code':
        authPlugins.set(
          'invite_code',
          new InviteCodeAuthMethod(config.invite_codes ?? []),
        );
        break;
      case 'agent_whitelist':
        authPlugins.set(
          'agent_whitelist',
          new AgentWhitelistAuthMethod(config.allowed_agents ?? []),
        );
        break;
    }
  }

  let proofGenerator: LairProofGenerator | undefined;
  if (config.membrane_proof?.enabled) {
    proofGenerator = await LairProofGenerator.fromSeed(randomBytes(32));
  }

  const urlProvider = new StaticUrlProvider(['wss://linker.example.com:8090']);

  const ctx: ServiceContext = {
    config,
    sessionStore,
    authPlugins,
    proofGenerator,
    urlProvider,
  };

  const app = createApp(ctx);

  const server = await new Promise<http.Server>((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0 }, () => {
      resolve(s as unknown as http.Server);
    });
  });

  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    ctx,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

// A valid 39-byte AgentPubKey, base64-encoded
export function fakeAgentKey(seed = 0): string {
  const bytes = new Uint8Array(39);
  bytes[0] = 0x84;
  bytes[1] = 0x20;
  bytes[2] = 0x24;
  for (let i = 3; i < 39; i++) {
    bytes[i] = (seed + i) & 0xff;
  }
  return Buffer.from(bytes).toString('base64');
}
