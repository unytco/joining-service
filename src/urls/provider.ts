import type { HttpGateway } from '../types.js';
import type { LinkerRegistration } from '../linker-auth/types.js';

/**
 * Provides the current set of linker registrations and HTTP gateway URLs.
 * Implementations may read from static config, Cloudflare KV, a database,
 * or any other dynamic source.
 */
export interface UrlProvider {
  /**
   * Returns the list of linker registrations for this deployment,
   * or undefined if this service does not manage linker relay URLs.
   *
   * Each registration includes the client-safe WSS URL and optional
   * admin credentials. Registrations without admin credentials represent
   * open linkers that require no authorization.
   */
  getLinkerRegistrations(): Promise<LinkerRegistration[] | undefined>;

  /**
   * Returns the list of read-only HTTP gateway instances,
   * or undefined if this service does not publish gateway information.
   * Each entry may include an optional `expires_at` (ISO 8601).
   */
  getHttpGateways(): Promise<HttpGateway[] | undefined>;
}
