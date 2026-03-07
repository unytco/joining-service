// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import '../../src/ui/joining-status.js';
import type { JoiningStatus } from '../../src/ui/joining-status.js';

function createStatus(): JoiningStatus {
  const el = document.createElement('joining-status') as JoiningStatus;
  document.body.appendChild(el);
  return el;
}

describe('JoiningStatus', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders nothing when idle', async () => {
    const el = createStatus();
    await el.updateComplete;
    expect(el.querySelector('[role="status"]')).toBeNull();
  });

  it('renders connecting status', async () => {
    const el = createStatus();
    el.status = 'connecting';
    await el.updateComplete;

    const status = el.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute('data-status')).toBe('connecting');
    expect(el.querySelector('[part="status-text"]')?.textContent).toBe(
      'Connecting to joining service...',
    );
  });

  it('renders error with reason and retry button', async () => {
    const el = createStatus();
    el.status = 'error';
    el.reason = 'Network timeout';
    await el.updateComplete;

    expect(el.querySelector('[part="status-reason"]')?.textContent).toBe('Network timeout');
    expect(el.querySelector('[part="retry-button"]')).not.toBeNull();
  });

  it('renders rejected with retry button', async () => {
    const el = createStatus();
    el.status = 'rejected';
    el.reason = 'Invalid invite code';
    await el.updateComplete;

    expect(el.querySelector('[part="retry-button"]')).not.toBeNull();
    expect(el.querySelector('[part="status-reason"]')?.textContent).toBe('Invalid invite code');
  });

  it('emits retry event on retry button click', async () => {
    const el = createStatus();
    el.status = 'error';
    await el.updateComplete;

    const retried = new Promise<void>((resolve) => {
      el.addEventListener('retry', () => resolve());
    });

    const retryBtn = el.querySelector('[part="retry-button"]') as HTMLButtonElement;
    retryBtn.click();

    await retried;
  });

  it('does not show retry button for non-error statuses', async () => {
    const el = createStatus();
    el.status = 'verifying';
    await el.updateComplete;

    expect(el.querySelector('[part="retry-button"]')).toBeNull();
  });

  it('does not show reason when none provided', async () => {
    const el = createStatus();
    el.status = 'error';
    await el.updateComplete;

    expect(el.querySelector('[part="status-reason"]')).toBeNull();
  });
});
