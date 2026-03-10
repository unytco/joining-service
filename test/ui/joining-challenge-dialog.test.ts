// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import type { Challenge } from '../../src/types.js';
import '../../src/ui/joining-challenge-dialog.js';
import type { JoiningChallengeDialog, ChallengeResponseDetail } from '../../src/ui/joining-challenge-dialog.js';

function createDialog(): JoiningChallengeDialog {
  const el = document.createElement('joining-challenge-dialog') as JoiningChallengeDialog;
  document.body.appendChild(el);
  return el;
}

function makeChallenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    id: 'ch_1',
    type: 'invite_code',
    description: 'Enter your invite code',
    ...overrides,
  };
}

describe('JoiningChallengeDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders nothing when closed', async () => {
    const el = createDialog();
    await el.updateComplete;
    expect(el.querySelector('dialog')).toBeNull();
  });

  it('renders dialog when open with a challenge', async () => {
    const el = createDialog();
    el.challenge = makeChallenge();
    el.open = true;
    await el.updateComplete;

    const dialog = el.querySelector('dialog');
    expect(dialog).not.toBeNull();

    const desc = el.querySelector('[part="description"]');
    expect(desc?.textContent).toBe('Enter your invite code');
  });

  it('renders nothing for agent_whitelist challenges', async () => {
    const el = createDialog();
    el.challenge = makeChallenge({ type: 'agent_whitelist' });
    el.open = true;
    await el.updateComplete;
    expect(el.querySelector('dialog')).toBeNull();
  });

  it('renders waiting state for hc_auth_approval', async () => {
    const el = createDialog();
    el.challenge = makeChallenge({
      type: 'hc_auth_approval',
      description: 'Awaiting operator approval',
    });
    el.open = true;
    await el.updateComplete;

    const waiting = el.querySelector('[part="waiting"]');
    expect(waiting).not.toBeNull();
    // No form/input for polling types
    expect(el.querySelector('form')).toBeNull();
  });

  it('emits challenge-response on form submit', async () => {
    const el = createDialog();
    el.challenge = makeChallenge();
    el.open = true;
    await el.updateComplete;

    const input = el.querySelector('input#challenge-input') as HTMLInputElement;
    input.value = 'MY_CODE';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;

    const responded = new Promise<ChallengeResponseDetail>((resolve) => {
      el.addEventListener('challenge-response', ((e: CustomEvent<ChallengeResponseDetail>) => {
        resolve(e.detail);
      }) as EventListener);
    });

    const form = el.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const detail = await responded;
    expect(detail.challengeId).toBe('ch_1');
    expect(detail.response).toBe('MY_CODE');
  });

  it('prompt() resolves with the user response', async () => {
    const el = createDialog();
    await el.updateComplete;

    const challenge = makeChallenge({ id: 'ch_prompt' });
    const resultPromise = el.prompt(challenge);

    // Wait for the dialog to render
    await el.updateComplete;

    expect(el.open).toBe(true);
    const input = el.querySelector('input#challenge-input') as HTMLInputElement;
    input.value = 'PROMPT_RESPONSE';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;

    const form = el.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const result = await resultPromise;
    expect(result).toBe('PROMPT_RESPONSE');
    expect(el.open).toBe(false);
  });

  it('emits challenge-cancelled on cancel click', async () => {
    const el = createDialog();
    el.challenge = makeChallenge();
    el.open = true;
    await el.updateComplete;

    const cancelled = new Promise<void>((resolve) => {
      el.addEventListener('challenge-cancelled', () => resolve());
    });

    const cancelBtn = el.querySelector('[part="cancel-button"]') as HTMLButtonElement;
    cancelBtn.click();

    await cancelled;
    expect(el.open).toBe(false);
  });

  it('renders email_code challenge with code input', async () => {
    const el = createDialog();
    el.challenge = makeChallenge({
      type: 'email_code',
      description: 'Enter the code sent to your email',
    });
    el.open = true;
    await el.updateComplete;

    const input = el.querySelector('input#challenge-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe('123456');

    const label = el.querySelector('[part="label"]');
    expect(label?.textContent).toBe('Verification Code');
  });
});
