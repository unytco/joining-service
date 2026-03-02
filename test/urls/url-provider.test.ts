import { describe, it, expect } from 'vitest';
import { StaticUrlProvider } from '../../src/urls/static.js';
import { KvUrlProvider } from '../../src/urls/kv.js';
import type { HttpGateway } from '../../src/types.js';

const GATEWAY: HttpGateway = { url: 'https://gw.example.com', dna_hashes: ['uhC0k123'], status: 'available' };

describe('StaticUrlProvider', () => {
  it('wraps plain string URLs as LinkerUrl entries without expiry', async () => {
    const p = new StaticUrlProvider(['wss://l1.example.com:8090', 'wss://l2.example.com:8090']);
    expect(await p.getLinkerUrls()).toEqual([
      { url: 'wss://l1.example.com:8090' },
      { url: 'wss://l2.example.com:8090' },
    ]);
  });

  it('returns undefined when no linker URLs configured', async () => {
    const p = new StaticUrlProvider();
    expect(await p.getLinkerUrls()).toBeUndefined();
  });

  it('returns undefined for empty linker URL array', async () => {
    const p = new StaticUrlProvider([]);
    expect(await p.getLinkerUrls()).toBeUndefined();
  });

  it('returns configured gateways', async () => {
    const p = new StaticUrlProvider(undefined, [GATEWAY]);
    expect(await p.getHttpGateways()).toEqual([GATEWAY]);
  });

  it('returns undefined when no gateways configured', async () => {
    const p = new StaticUrlProvider();
    expect(await p.getHttpGateways()).toBeUndefined();
  });
});

describe('KvUrlProvider', () => {
  function makeKv(data: Record<string, string>) {
    return {
      async get(key: string) { return data[key] ?? null; },
      async put() {},
      async delete() {},
    };
  }

  it('returns LinkerUrl entries from KV (with expiry)', async () => {
    const entry = { url: 'wss://l1.example.com:8090', expires_at: '2026-03-01T00:00:00Z' };
    const kv = makeKv({ linker_urls: JSON.stringify([entry]) });
    const p = new KvUrlProvider(kv);
    expect(await p.getLinkerUrls()).toEqual([entry]);
  });

  it('returns LinkerUrl entries without expiry from KV', async () => {
    const kv = makeKv({ linker_urls: JSON.stringify([{ url: 'wss://l1.example.com:8090' }]) });
    const p = new KvUrlProvider(kv);
    expect(await p.getLinkerUrls()).toEqual([{ url: 'wss://l1.example.com:8090' }]);
  });

  it('returns undefined when linker_urls key absent', async () => {
    const p = new KvUrlProvider(makeKv({}));
    expect(await p.getLinkerUrls()).toBeUndefined();
  });

  it('returns undefined when linker_urls is empty array in KV', async () => {
    const p = new KvUrlProvider(makeKv({ linker_urls: '[]' }));
    expect(await p.getLinkerUrls()).toBeUndefined();
  });

  it('returns gateways from KV', async () => {
    const kv = makeKv({ http_gateways: JSON.stringify([GATEWAY]) });
    const p = new KvUrlProvider(kv);
    expect(await p.getHttpGateways()).toEqual([GATEWAY]);
  });

  it('returns undefined when http_gateways key absent', async () => {
    const p = new KvUrlProvider(makeKv({}));
    expect(await p.getHttpGateways()).toBeUndefined();
  });

  it('reflects KV updates between calls', async () => {
    const data: Record<string, string> = {};
    const kv = makeKv(data);
    const p = new KvUrlProvider(kv);

    expect(await p.getLinkerUrls()).toBeUndefined();

    data.linker_urls = JSON.stringify([{ url: 'wss://new.example.com:8090' }]);
    expect(await p.getLinkerUrls()).toEqual([{ url: 'wss://new.example.com:8090' }]);
  });
});
