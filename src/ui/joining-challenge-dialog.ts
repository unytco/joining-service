import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { createRef, ref } from 'lit/directives/ref.js';
import type { Challenge } from '../types.js';

/** Challenge types that are handled automatically (no user input). */
const AUTO_CHALLENGE_TYPES = new Set(['agent_whitelist', 'open']);

/** Challenge types that show a waiting/polling state instead of an input. */
const POLLING_TYPES = new Set(['hc_auth_approval']);

export interface ChallengeResponseDetail {
  challengeId: string;
  response: string;
}

/**
 * Headless dialog component that prompts the user for a challenge response.
 *
 * For invite_code, email_code, sms_code: shows a text input.
 * For hc_auth_approval: shows a waiting indicator (no input).
 * For agent_whitelist, open: not rendered (handled automatically by orchestrator).
 * For unknown/custom types: shows a generic text input + slot.
 */
@customElement('joining-challenge-dialog')
export class JoiningChallengeDialog extends LitElement {
  @property({ type: Object })
  challenge: Challenge | null = null;

  @property({ type: Boolean, reflect: true })
  open = false;

  @state()
  private inputValue = '';

  private dialogRef = createRef<HTMLDialogElement>();

  /** Disable shadow DOM so consumers can style freely. */
  protected override createRenderRoot() {
    return this;
  }

  protected override updated(changed: Map<string, unknown>) {
    if (changed.has('open')) {
      const dialog = this.dialogRef.value;
      if (!dialog) return;
      if (this.open && !dialog.open) {
        dialog.showModal();
      } else if (!this.open && dialog.open) {
        dialog.close();
      }
    }
  }

  /** Programmatic API: show the dialog for a given challenge and return the response. */
  prompt(challenge: Challenge): Promise<string> {
    return new Promise((resolve, reject) => {
      this.challenge = challenge;
      this.inputValue = '';
      this.open = true;

      const handleResponse = (e: Event) => {
        const detail = (e as CustomEvent<ChallengeResponseDetail>).detail;
        cleanup();
        resolve(detail.response);
      };

      const handleCancel = () => {
        cleanup();
        reject(new Error('Challenge cancelled'));
      };

      const cleanup = () => {
        this.removeEventListener('challenge-response', handleResponse);
        this.removeEventListener('challenge-cancelled', handleCancel);
        this.open = false;
        this.challenge = null;
      };

      this.addEventListener('challenge-response', handleResponse);
      this.addEventListener('challenge-cancelled', handleCancel);
    });
  }

  close() {
    this.open = false;
    this.dispatchEvent(
      new CustomEvent('challenge-cancelled', { bubbles: true, composed: true }),
    );
  }

  private handleSubmit(e: Event) {
    e.preventDefault();
    if (!this.challenge || !this.inputValue.trim()) return;

    this.dispatchEvent(
      new CustomEvent<ChallengeResponseDetail>('challenge-response', {
        detail: {
          challengeId: this.challenge.id,
          response: this.inputValue.trim(),
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleDialogClose() {
    // Native dialog was closed (e.g. Escape key) — treat as cancel
    if (this.open) {
      this.close();
    }
  }

  protected override render() {
    if (!this.challenge) return nothing;
    if (AUTO_CHALLENGE_TYPES.has(this.challenge.type)) return nothing;

    const isPolling = POLLING_TYPES.has(this.challenge.type);

    return html`
      <dialog
        ${ref(this.dialogRef)}
        part="dialog"
        aria-label=${this.challenge.description}
        @close=${this.handleDialogClose}
        @cancel=${(e: Event) => {
          // Prevent default cancel (Escape) for polling types
          if (isPolling) e.preventDefault();
        }}
      >
        <p part="description">${this.challenge.description}</p>

        ${isPolling
          ? html`
              <div part="waiting" role="status" aria-live="polite">
                <slot name="waiting-indicator">Waiting for approval...</slot>
              </div>
            `
          : html`
              <form @submit=${this.handleSubmit} novalidate>
                ${this.renderChallengeInput()}
                <div part="actions">
                  <button
                    type="button"
                    part="cancel-button"
                    @click=${() => this.close()}
                  >Cancel</button>
                  <button
                    type="submit"
                    part="submit-button"
                    ?disabled=${!this.inputValue.trim()}
                  >Verify</button>
                </div>
              </form>
            `}
      </dialog>
    `;
  }

  private renderChallengeInput() {
    if (!this.challenge) return nothing;

    const type = this.challenge.type;
    const inputConfig = CHALLENGE_INPUT[type];

    if (inputConfig) {
      return html`
        <div part="field">
          <label part="label" for="challenge-input">${inputConfig.label}</label>
          <input
            part="input"
            id="challenge-input"
            type=${inputConfig.inputType}
            placeholder=${inputConfig.placeholder}
            .value=${this.inputValue}
            @input=${(e: InputEvent) => {
              this.inputValue = (e.target as HTMLInputElement).value;
            }}
            required
            aria-required="true"
            autocomplete="one-time-code"
          />
        </div>
      `;
    }

    // Unknown type: generic input + slot for custom UI
    return html`
      <div part="field">
        <slot name=${`challenge-${type}`}>
          <label part="label" for="challenge-input">Response</label>
          <input
            part="input"
            id="challenge-input"
            type="text"
            placeholder="Enter your response"
            .value=${this.inputValue}
            @input=${(e: InputEvent) => {
              this.inputValue = (e.target as HTMLInputElement).value;
            }}
            required
            aria-required="true"
          />
        </slot>
      </div>
    `;
  }
}

const CHALLENGE_INPUT: Record<string, { label: string; inputType: string; placeholder: string }> = {
  invite_code: { label: 'Invite Code', inputType: 'text', placeholder: 'Enter your invite code' },
  email_code: { label: 'Verification Code', inputType: 'text', placeholder: '123456' },
  sms_code: { label: 'Verification Code', inputType: 'text', placeholder: '123456' },
};

declare global {
  interface HTMLElementTagNameMap {
    'joining-challenge-dialog': JoiningChallengeDialog;
  }
}
