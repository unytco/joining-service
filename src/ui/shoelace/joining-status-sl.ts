import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { JoiningStatusValue } from '../joining-status.js';

import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

const STATUS_CONFIG: Record<JoiningStatusValue, {
  text: string;
  variant: 'primary' | 'success' | 'warning' | 'danger' | 'neutral';
  icon: string;
  showSpinner: boolean;
}> = {
  idle: { text: '', variant: 'neutral', icon: '', showSpinner: false },
  connecting: { text: 'Connecting to joining service...', variant: 'primary', icon: 'cloud', showSpinner: true },
  'collecting-claims': { text: 'Please provide your credentials.', variant: 'primary', icon: 'key', showSpinner: false },
  joining: { text: 'Starting join session...', variant: 'primary', icon: 'box-arrow-in-right', showSpinner: true },
  verifying: { text: 'Verifying...', variant: 'primary', icon: 'shield-check', showSpinner: true },
  provisioning: { text: 'Setting up your account...', variant: 'primary', icon: 'gear', showSpinner: true },
  ready: { text: 'Successfully joined.', variant: 'success', icon: 'check-circle', showSpinner: false },
  rejected: { text: 'Join request was rejected.', variant: 'danger', icon: 'x-circle', showSpinner: false },
  error: { text: 'An error occurred.', variant: 'danger', icon: 'exclamation-triangle', showSpinner: false },
};

@customElement('joining-status-sl')
export class JoiningStatusSl extends LitElement {
  static override styles = css`
    :host {
      display: block;
      font-family: var(--sl-font-sans, sans-serif);
    }
    .status-content {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .status-text {
      flex: 1;
    }
    .reason {
      display: block;
      font-size: var(--sl-font-size-small, 0.875rem);
      color: var(--sl-color-neutral-600, #666);
      margin-top: 0.25rem;
    }
    sl-spinner {
      font-size: 1rem;
      --indicator-color: var(--sl-color-primary-600, #2563eb);
    }
    .retry {
      margin-top: 0.75rem;
    }
  `;

  @property()
  status: JoiningStatusValue = 'idle';

  @property()
  reason?: string;

  private handleRetry() {
    this.dispatchEvent(
      new CustomEvent('retry', { bubbles: true, composed: true }),
    );
  }

  protected override render() {
    if (this.status === 'idle') return nothing;

    const config = STATUS_CONFIG[this.status];
    const isError = this.status === 'error' || this.status === 'rejected';

    return html`
      <sl-alert variant=${config.variant} open>
        <sl-icon slot="icon" name=${config.icon}></sl-icon>
        <div class="status-content">
          ${config.showSpinner ? html`<sl-spinner></sl-spinner>` : nothing}
          <div class="status-text">
            ${config.text}
            ${this.reason
              ? html`<span class="reason">${this.reason}</span>`
              : nothing}
          </div>
        </div>
        ${isError
          ? html`
              <div class="retry">
                <sl-button size="small" variant="default" @click=${this.handleRetry}>
                  Retry
                </sl-button>
              </div>
            `
          : nothing}
      </sl-alert>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'joining-status-sl': JoiningStatusSl;
  }
}
