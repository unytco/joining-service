import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Challenge } from '../../types.js';
import type { ChallengeResponseDetail } from '../joining-challenge-dialog.js';

import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';

const AUTO_CHALLENGE_TYPES = new Set(['agent_whitelist', 'open']);
const POLLING_TYPES = new Set(['hc_auth_approval']);

const CHALLENGE_INPUT: Record<string, { label: string; inputType: string; placeholder: string }> = {
  invite_code: { label: 'Invite Code', inputType: 'text', placeholder: 'Enter your invite code' },
  email_code: { label: 'Verification Code', inputType: 'text', placeholder: '123456' },
  sms_code: { label: 'Verification Code', inputType: 'text', placeholder: '123456' },
};

@customElement('joining-challenge-dialog-sl')
export class JoiningChallengeDialogSl extends LitElement {
  static override styles = css`
    :host {
      font-family: var(--sl-font-sans);
    }
    .description {
      margin-bottom: var(--joining-field-spacing, 1rem);
      color: var(--sl-color-neutral-700);
    }
    .waiting {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
      padding: 2rem 0;
      color: var(--sl-color-neutral-600);
    }
    .waiting sl-spinner {
      font-size: 2rem;
      --indicator-color: var(--sl-color-primary-600);
    }
    .actions {
      display: flex;
      gap: var(--joining-action-gap, 0.5rem);
      justify-content: flex-end;
      margin-top: var(--joining-action-margin-top, 1.5rem);
    }
  `;

  @property({ type: Object })
  challenge: Challenge | null = null;

  @property({ type: Boolean, reflect: true })
  open = false;

  @state()
  private inputValue = '';

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
        reject(new Error('Challenge cancelled by user'));
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

  private handleDialogRequestClose(e: CustomEvent) {
    // Prevent closing via overlay click or escape during polling
    if (this.challenge && POLLING_TYPES.has(this.challenge.type)) {
      e.preventDefault();
      return;
    }
    this.close();
  }

  protected override render() {
    if (!this.challenge) return nothing;
    if (AUTO_CHALLENGE_TYPES.has(this.challenge.type)) return nothing;

    const isPolling = POLLING_TYPES.has(this.challenge.type);

    return html`
      <sl-dialog
        label=${isPolling ? 'Please Wait' : 'Verification Required'}
        ?open=${this.open}
        @sl-request-close=${this.handleDialogRequestClose}
      >
        <p class="description">${this.challenge.description}</p>

        ${isPolling
          ? html`
              <div class="waiting">
                <sl-spinner></sl-spinner>
                <span>Waiting for approval...</span>
              </div>
            `
          : html`
              ${this.renderChallengeInput()}
              <div class="actions" slot="footer">
                <sl-button variant="default" @click=${() => this.close()}>
                  Cancel
                </sl-button>
                <sl-button
                  variant="primary"
                  ?disabled=${!this.inputValue.trim()}
                  @click=${this.handleSubmit}
                >
                  Verify
                </sl-button>
              </div>
            `}
      </sl-dialog>
    `;
  }

  private renderChallengeInput() {
    if (!this.challenge) return nothing;

    const config = CHALLENGE_INPUT[this.challenge.type];

    if (config) {
      return html`
        <sl-input
          label=${config.label}
          type=${config.inputType}
          placeholder=${config.placeholder}
          value=${this.inputValue}
          @sl-input=${(e: CustomEvent) => {
            this.inputValue = (e.target as HTMLInputElement).value;
          }}
          required
        ></sl-input>
      `;
    }

    return html`
      <slot name=${`challenge-${this.challenge.type}`}>
        <sl-input
          label="Response"
          placeholder="Enter your response"
          value=${this.inputValue}
          @sl-input=${(e: CustomEvent) => {
            this.inputValue = (e.target as HTMLInputElement).value;
          }}
          required
        ></sl-input>
      </slot>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'joining-challenge-dialog-sl': JoiningChallengeDialogSl;
  }
}
