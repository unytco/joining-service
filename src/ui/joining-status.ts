import { LitElement, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

export type JoiningStatusValue =
  | 'idle'
  | 'connecting'
  | 'collecting-claims'
  | 'joining'
  | 'verifying'
  | 'provisioning'
  | 'ready'
  | 'rejected'
  | 'error';

const STATUS_TEXT: Record<JoiningStatusValue, string> = {
  idle: '',
  connecting: 'Connecting to joining service...',
  'collecting-claims': 'Please provide your credentials.',
  joining: 'Starting join session...',
  verifying: 'Verifying...',
  provisioning: 'Setting up your account...',
  ready: 'Successfully joined.',
  rejected: 'Join request was rejected.',
  error: 'An error occurred.',
};

/**
 * Headless status indicator for the joining flow.
 * Renders a live region that announces status changes to screen readers.
 */
@customElement('joining-status')
export class JoiningStatus extends LitElement {
  @property()
  status: JoiningStatusValue = 'idle';

  @property()
  reason?: string;

  /** Disable shadow DOM for external styling. */
  protected override createRenderRoot() {
    return this;
  }

  private handleRetry() {
    this.dispatchEvent(
      new CustomEvent('retry', { bubbles: true, composed: true }),
    );
  }

  protected override render() {
    if (this.status === 'idle') return nothing;

    const isError = this.status === 'error' || this.status === 'rejected';
    const text = STATUS_TEXT[this.status];

    return html`
      <div
        part="status"
        role="status"
        aria-live="polite"
        data-status=${this.status}
      >
        <span part="status-text">${text}</span>
        ${this.reason
          ? html`<span part="status-reason">${this.reason}</span>`
          : nothing}
        ${isError
          ? html`<button part="retry-button" @click=${this.handleRetry}>Retry</button>`
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'joining-status': JoiningStatus;
  }
}
