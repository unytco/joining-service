import type { HttpGateway, LinkerUrl } from '../types.js';
import type { UrlProvider } from './provider.js';

/**
 * UrlProvider backed by static configuration values.
 * This is the default provider for Node.js deployments where
 * linker and gateway URLs are known at startup time.
 *
 * Config provides plain string[] for linker URLs; this provider wraps them
 * as LinkerUrl entries without expiry (no per-URL TTL is known statically).
 */
export class StaticUrlProvider implements UrlProvider {
  private readonly entries: LinkerUrl[] | undefined;

  constructor(
    linkerUrls?: string[],
    private readonly httpGateways?: HttpGateway[],
  ) {
    this.entries = linkerUrls?.length
      ? linkerUrls.map((url) => ({ url }))
      : undefined;
  }

  async getLinkerUrls(): Promise<LinkerUrl[] | undefined> {
    return this.entries;
  }

  async getHttpGateways(): Promise<HttpGateway[] | undefined> {
    return this.httpGateways?.length ? this.httpGateways : undefined;
  }
}
