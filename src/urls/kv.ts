import type { HttpGateway, LinkerUrl } from '../types.js';
import type { UrlProvider } from './provider.js';

/** Cloudflare KV namespace binding (subset of the Workers runtime type). */
export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * UrlProvider backed by Cloudflare Workers KV.
 *
 * Reads the current linker and gateway URL lists from KV at request time,
 * so updates written to KV are reflected without redeploying the worker.
 *
 * Expected KV keys:
 *   `linker_urls`    — JSON-encoded LinkerUrl[]
 *                      e.g. [{"url":"wss://l1.example.com:8090","expires_at":"2026-03-01T00:00:00Z"}]
 *   `http_gateways`  — JSON-encoded HttpGateway[]
 *
 * Either key may be absent; the provider returns undefined in that case.
 */
export class KvUrlProvider implements UrlProvider {
  constructor(private readonly kv: KVNamespace) {}

  async getLinkerUrls(): Promise<LinkerUrl[] | undefined> {
    const raw = await this.kv.get('linker_urls');
    if (!raw) return undefined;
    const entries = JSON.parse(raw) as LinkerUrl[];
    return entries.length ? entries : undefined;
  }

  async getHttpGateways(): Promise<HttpGateway[] | undefined> {
    const raw = await this.kv.get('http_gateways');
    if (!raw) return undefined;
    const entries = JSON.parse(raw) as HttpGateway[];
    return entries.length ? entries : undefined;
  }
}
