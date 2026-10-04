// Errors whose message is safe to show to end users. Anything else is replaced by a generic message,
// and upstream response bodies only ever go to server logs, with secrets redacted.
export class PublicError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.public = true;
    this.status = status;
  }
}

export const publicMessage = (e) => (e && e.public ? e.message : 'Something went wrong. Please try again.');

export function logUpstream(service, status, text, secret) {
  const body = secret ? String(text).split(secret).join('***') : String(text);
  console.error(`[${service}] ${status} ${body.slice(0, 300)}`);
}
