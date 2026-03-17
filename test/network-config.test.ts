import { describe, it, expect } from 'vitest';
import { createTestApp, fakeAgentKey } from './helpers.js';

describe('Network config', () => {
  // --- Provision endpoint ---

  it('provision includes network_config when network and hc_auth are configured', async () => {
    const { request } = await createTestApp({
      network: {
        bootstrap_url: 'https://bootstrap.example.com',
        relay_url: 'wss://relay.example.com',
      },
      hc_auth: {
        url: 'https://auth.example.com',
        api_token: 'test-token',
      },
    });
    const agentKey = fakeAgentKey();

    const joinRes = await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_key: agentKey }),
    });
    const { session } = await joinRes.json();

    const provRes = await request(`/v1/join/${session}/provision`);
    expect(provRes.status).toBe(200);

    const prov = await provRes.json();
    expect(prov.network_config).toEqual({
      auth_server_url: 'https://auth.example.com',
      bootstrap_url: 'https://bootstrap.example.com',
      relay_url: 'wss://relay.example.com',
    });
  });

  it('provision includes network_config with only bootstrap_url', async () => {
    const { request } = await createTestApp({
      network: {
        bootstrap_url: 'https://bootstrap.example.com',
      },
    });
    const agentKey = fakeAgentKey();

    const joinRes = await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_key: agentKey }),
    });
    const { session } = await joinRes.json();

    const provRes = await request(`/v1/join/${session}/provision`);
    const prov = await provRes.json();
    expect(prov.network_config).toEqual({
      bootstrap_url: 'https://bootstrap.example.com',
    });
  });

  it('provision includes auth_server_url from hc_auth.url even without network config', async () => {
    const { request } = await createTestApp({
      hc_auth: {
        url: 'https://auth.example.com',
        api_token: 'test-token',
      },
    });
    const agentKey = fakeAgentKey();

    const joinRes = await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_key: agentKey }),
    });
    const { session } = await joinRes.json();

    const provRes = await request(`/v1/join/${session}/provision`);
    const prov = await provRes.json();
    expect(prov.network_config).toEqual({
      auth_server_url: 'https://auth.example.com',
    });
  });

  it('provision omits network_config when nothing is configured', async () => {
    const { request } = await createTestApp();
    const agentKey = fakeAgentKey();

    const joinRes = await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_key: agentKey }),
    });
    const { session } = await joinRes.json();

    const provRes = await request(`/v1/join/${session}/provision`);
    const prov = await provRes.json();
    expect(prov.network_config).toBeUndefined();
  });

  // --- Info endpoint ---

  it('info omits network_config by default', async () => {
    const { request } = await createTestApp({
      network: {
        bootstrap_url: 'https://bootstrap.example.com',
        relay_url: 'wss://relay.example.com',
      },
      hc_auth: {
        url: 'https://auth.example.com',
        api_token: 'test-token',
      },
    });

    const res = await request('/v1/info');
    const body = await res.json();
    expect(body.network_config).toBeUndefined();
  });

  it('info omits network_config when reveal_in_info is false', async () => {
    const { request } = await createTestApp({
      network: {
        bootstrap_url: 'https://bootstrap.example.com',
        relay_url: 'wss://relay.example.com',
        reveal_in_info: false,
      },
      hc_auth: {
        url: 'https://auth.example.com',
        api_token: 'test-token',
      },
    });

    const res = await request('/v1/info');
    const body = await res.json();
    expect(body.network_config).toBeUndefined();
  });

  it('info includes network_config when reveal_in_info is true', async () => {
    const { request } = await createTestApp({
      network: {
        bootstrap_url: 'https://bootstrap.example.com',
        relay_url: 'wss://relay.example.com',
        reveal_in_info: true,
      },
      hc_auth: {
        url: 'https://auth.example.com',
        api_token: 'test-token',
      },
    });

    const res = await request('/v1/info');
    const body = await res.json();
    expect(body.network_config).toEqual({
      auth_server_url: 'https://auth.example.com',
      bootstrap_url: 'https://bootstrap.example.com',
      relay_url: 'wss://relay.example.com',
    });
  });

  it('info includes partial network_config when reveal_in_info is true', async () => {
    const { request } = await createTestApp({
      network: {
        bootstrap_url: 'https://bootstrap.example.com',
        reveal_in_info: true,
      },
    });

    const res = await request('/v1/info');
    const body = await res.json();
    expect(body.network_config).toEqual({
      bootstrap_url: 'https://bootstrap.example.com',
    });
  });
});
