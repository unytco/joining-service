import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EmailTransport } from './transport.js';

export class FileTransport implements EmailTransport {
  private outputDir: string;

  constructor(outputDir = './dev-emails') {
    this.outputDir = outputDir;
    mkdirSync(this.outputDir, { recursive: true });
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    const now = new Date();
    const timestamp = now.toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
    const filename = `${timestamp}_${to}.txt`;
    const filepath = join(this.outputDir, filename);

    const content = [
      `To: ${to}`,
      `Subject: ${subject}`,
      `Date: ${now.toISOString()}`,
      '',
      body,
      '',
    ].join('\n');

    writeFileSync(filepath, content, 'utf-8');
  }
}
