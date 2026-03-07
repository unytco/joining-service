// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import type { AuthMethodEntry } from '../../src/types.js';
import '../../src/ui/joining-claims-form.js';
import type { JoiningClaimsForm, ClaimsSubmittedDetail } from '../../src/ui/joining-claims-form.js';

async function nextFrame(): Promise<void> {
  await new Promise((r) => requestAnimationFrame(r));
}

function createForm(authMethods: AuthMethodEntry[]): JoiningClaimsForm {
  const el = document.createElement('joining-claims-form') as JoiningClaimsForm;
  el.authMethods = authMethods;
  document.body.appendChild(el);
  return el;
}

describe('JoiningClaimsForm', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders nothing for open auth (automatic)', async () => {
    const el = createForm(['open']);
    await el.updateComplete;
    // open is auto — no form rendered
    expect(el.querySelector('form')).toBeNull();
  });

  it('renders nothing for agent_whitelist (automatic)', async () => {
    const el = createForm(['agent_whitelist']);
    await el.updateComplete;
    expect(el.querySelector('form')).toBeNull();
  });

  it('renders invite code input', async () => {
    const el = createForm(['invite_code']);
    await el.updateComplete;
    const input = el.querySelector('input#claim-invite_code') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.type).toBe('text');
    expect(input.placeholder).toBe('Enter your invite code');
  });

  it('renders email input for email_code', async () => {
    const el = createForm(['email_code']);
    await el.updateComplete;
    const input = el.querySelector('input#claim-email_code') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.type).toBe('email');
  });

  it('submit button is disabled when input is empty', async () => {
    const el = createForm(['invite_code']);
    await el.updateComplete;
    const submit = el.querySelector('[part="submit-button"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('emits claims-submitted with collected values', async () => {
    const el = createForm(['invite_code']);
    await el.updateComplete;

    const input = el.querySelector('input#claim-invite_code') as HTMLInputElement;
    input.value = 'ABC123';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;

    const submitted = new Promise<ClaimsSubmittedDetail>((resolve) => {
      el.addEventListener('claims-submitted', ((e: CustomEvent<ClaimsSubmittedDetail>) => {
        resolve(e.detail);
      }) as EventListener);
    });

    const form = el.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const detail = await submitted;
    expect(detail.claims).toEqual({ invite_code: 'ABC123' });
  });

  it('emits claims-cancelled when cancel is clicked', async () => {
    const el = createForm(['invite_code']);
    await el.updateComplete;

    const cancelled = new Promise<void>((resolve) => {
      el.addEventListener('claims-cancelled', () => resolve());
    });

    const cancelBtn = el.querySelector('[part="cancel-button"]') as HTMLButtonElement;
    cancelBtn.click();

    await cancelled;
  });

  it('renders OR group with radio selection', async () => {
    const el = createForm([{ any_of: ['invite_code', 'email_code'] }]);
    await el.updateComplete;

    const radios = el.querySelectorAll('input[type="radio"]');
    expect(radios.length).toBe(2);

    // First method should be selected by default
    const fieldset = el.querySelector('fieldset');
    expect(fieldset).not.toBeNull();
  });

  it('switches displayed input when OR group selection changes', async () => {
    const el = createForm([{ any_of: ['invite_code', 'email_code'] }]);
    await el.updateComplete;

    // Default: first method (invite_code) is shown
    expect(el.querySelector('input#claim-invite_code')).not.toBeNull();
    expect(el.querySelector('input#claim-email_code')).toBeNull();

    // Select email_code
    const radios = el.querySelectorAll('input[type="radio"]');
    (radios[1] as HTMLInputElement).checked = true;
    radios[1].dispatchEvent(new Event('change', { bubbles: true }));
    await el.updateComplete;

    expect(el.querySelector('input#claim-invite_code')).toBeNull();
    expect(el.querySelector('input#claim-email_code')).not.toBeNull();
  });

  it('renders multiple standalone methods', async () => {
    const el = createForm(['invite_code', 'email_code']);
    await el.updateComplete;

    expect(el.querySelector('input#claim-invite_code')).not.toBeNull();
    expect(el.querySelector('input#claim-email_code')).not.toBeNull();
  });
});
