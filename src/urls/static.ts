import type { HttpGateway } from '../types.js';
import type { LinkerRegistration } from '../linker-auth/types.js';
import type { UrlProvider } from './provider.js';

/**
 * UrlProvider backed by static configuration values.
 * This is the default provider for Node.js deployments where
 * linker and gateway URLs are known at startup time.
 *
 * Accepts either LinkerRegistration[] (full registration objects) or
 * plain string[] (bare WSS URLs wrapped as open linker registrations
 * without admin credentials or expiry).
 */
export class StaticUrlProvider implements UrlProvider {
  private readonly registrations: LinkerRegistration[] | undefined;

  constructor(
    linkerUrls?: string[] | LinkerRegistration[],
    private readonly httpGateways?: HttpGateway[],
  ) {
    if (!linkerUrls?.length) {
      this.registrations = undefined;
    } else if (typeof linkerUrls[0] === 'string') {
      this.registrations = (linkerUrls as string[]).map((url) => ({
        linker_url: { url },
      }));
    } else {
      this.registrations = linkerUrls as LinkerRegistration[];
    }
  }

  async getLinkerRegistrations(): Promise<LinkerRegistration[] | undefined> {
    return this.registrations;
  }

  async getHttpGateways(): Promise<HttpGateway[] | undefined> {
    return this.httpGateways?.length ? this.httpGateways : undefined;
  }
}
