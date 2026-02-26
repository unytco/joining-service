export interface EmailTransport {
  send(to: string, subject: string, body: string): Promise<void>;
}
