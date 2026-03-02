import { readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { resolveConfig, type ServiceConfig } from './config.js';
import { createApp, type ServiceContext } from './app.js';
import { MemorySessionStore } from './session/memory-store.js';
import { SqliteSessionStore } from './session/sqlite-store.js';
import type { SessionStore } from './session/store.js';
import { OpenAuthMethod } from './auth-methods/open.js';
import { EmailCodeAuthMethod } from './auth-methods/email-code.js';
import { InviteCodeAuthMethod } from './auth-methods/invite-code.js';
import { FileTransport } from './email/file.js';
import { PostmarkTransport } from './email/postmark.js';
import { LairProofGenerator } from './membrane-proof/lair-signer.js';
import type { MembraneProofGenerator } from './membrane-proof/generator.js';
import type { AuthMethodPlugin } from './auth-methods/plugin.js';
import type { EmailTransport } from './email/transport.js';
import { StaticUrlProvider } from './urls/static.js';
import type { UrlProvider } from './urls/provider.js';
import { HcAuthClient } from './hc-auth/index.js';

function buildEmailTransport(config: ServiceConfig): EmailTransport | null {
  if (!config.email) return null;

  if (config.email.provider === 'file') {
    return new FileTransport(config.email.output_dir ?? './dev-emails');
  }

  if (config.email.provider === 'postmark') {
    if (!config.email.api_key || !config.email.from) {
      throw new Error('Postmark requires api_key and from');
    }
    return new PostmarkTransport(config.email.api_key, config.email.from);
  }

  return null;
}

function buildAuthPlugins(
  config: ServiceConfig,
  emailTransport: EmailTransport | null,
): Map<string, AuthMethodPlugin> {
  const plugins = new Map<string, AuthMethodPlugin>();

  for (const method of config.auth_methods) {
    switch (method) {
      case 'open':
        plugins.set('open', new OpenAuthMethod());
        break;

      case 'email_code':
        if (!emailTransport) {
          throw new Error(
            'email_code auth requires email config with a transport',
          );
        }
        plugins.set(
          'email_code',
          new EmailCodeAuthMethod({
            transport: emailTransport,
            subject: config.email?.template
              ? undefined
              : 'Your verification code',
            template: config.email?.template,
          }),
        );
        break;

      case 'invite_code':
        plugins.set(
          'invite_code',
          new InviteCodeAuthMethod(config.invite_codes ?? []),
        );
        break;

      default:
        console.warn(`Unknown auth method: ${method}, skipping`);
    }
  }

  return plugins;
}

async function buildProofGenerator(
  config: ServiceConfig,
): Promise<MembraneProofGenerator | undefined> {
  if (!config.membrane_proof?.enabled) return undefined;

  if (config.membrane_proof.signing_key_path) {
    const keyHex = readFileSync(
      config.membrane_proof.signing_key_path,
      'utf-8',
    ).trim();
    return LairProofGenerator.fromHex(keyHex);
  }

  // Generate ephemeral key for dev
  const { randomBytes } = await import('node:crypto');
  return LairProofGenerator.fromSeed(randomBytes(32));
}

function buildSessionStore(config: ServiceConfig): SessionStore {
  const pendingTtl = config.session!.pending_ttl_seconds;
  const readyTtl = config.session!.ready_ttl_seconds;

  if (config.session!.store === 'sqlite') {
    const dbPath = config.session!.db_path ?? './sessions.db';
    return new SqliteSessionStore(dbPath, pendingTtl, readyTtl);
  }

  return new MemorySessionStore(pendingTtl, readyTtl);
}

export async function startServer(
  configInput: Partial<ServiceConfig>,
  urlProvider?: UrlProvider,
): Promise<ReturnType<typeof serve>> {
  const config = resolveConfig(configInput);

  const sessionStore = buildSessionStore(config);

  const emailTransport = buildEmailTransport(config);
  const authPlugins = buildAuthPlugins(config, emailTransport);
  const proofGenerator = await buildProofGenerator(config);

  const resolvedUrlProvider = urlProvider ?? new StaticUrlProvider();

  const hcAuthClient = config.hc_auth
    ? new HcAuthClient(config.hc_auth)
    : undefined;

  const context: ServiceContext = {
    config,
    sessionStore,
    authPlugins,
    proofGenerator,
    urlProvider: resolvedUrlProvider,
    hcAuthClient,
  };

  const app = createApp(context);

  const server = serve({
    fetch: app.fetch,
    port: config.port,
  });

  console.log(`Joining service listening on port ${config.port}`);
  return server;
}

// CLI entry point
const configPath = process.argv[2] ?? './config.json';
try {
  const raw = readFileSync(configPath, 'utf-8');
  const { linker_urls, http_gateways, ...configInput } = JSON.parse(raw);
  const urlProvider = new StaticUrlProvider(linker_urls, http_gateways);
  startServer(configInput, urlProvider);
} catch (e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`Failed to start: ${message}`);
  process.exit(1);
}
