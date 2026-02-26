import type { EmailTransport } from './transport.js';

export class PostmarkTransport implements EmailTransport {
  private apiKey: string;
  private from: string;

  constructor(apiKey: string, from: string) {
    this.apiKey = apiKey;
    this.from = from;
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    const response = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': this.apiKey,
      },
      body: JSON.stringify({
        From: this.from,
        To: to,
        Subject: subject,
        TextBody: body,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Postmark API error (${response.status}): ${text}`);
    }
  }
}
