import { connect } from 'cloudflare:sockets';

// A minimal SMTP client over the Workers TCP sockets API, for Gmail's mail server. It speaks just
// enough to send one message: greeting, EHLO, AUTH PLAIN, MAIL FROM, RCPT TO, DATA and QUIT, over
// a TLS connection from the start (port 465). Workers block only port 25.

export interface Connection {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): Promise<void>;
}

export type Connect = (host: string, port: number) => Connection;

export const connectTls: Connect = (host, port) =>
  connect({ hostname: host, port }, { secureTransport: 'on', allowHalfOpen: false });

export interface SmtpMessage {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  to: string;
  /** The whole message, headers and body, with CRLF line endings. */
  data: string;
}

export async function sendSmtp(
  message: SmtpMessage,
  timeoutMs: number,
  open: Connect = connectTls,
): Promise<void> {
  const connection = open(message.host, message.port);
  const session = new Session(connection);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`No answer from ${message.host} within ${timeoutMs / 1000} s`)),
      timeoutMs,
    );
  });
  try {
    await Promise.race([session.send(message), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    await connection.close().catch(() => undefined);
  }
}

class Session {
  private readonly reader: ReadableStreamDefaultReader<string>;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = '';

  constructor(connection: Connection) {
    this.reader = connection.readable.pipeThrough(new TextDecoderStream()).getReader();
    this.writer = connection.writable.getWriter();
  }

  async send(message: SmtpMessage): Promise<void> {
    await this.expect('greeting', 220);
    await this.command('EHLO nkabom', 'EHLO', 250);
    const credentials = btoa(`\0${message.user}\0${message.password}`);
    // Labelled AUTH, so the credentials never appear in an error.
    await this.command(`AUTH PLAIN ${credentials}`, 'AUTH', 235);
    await this.command(`MAIL FROM:<${message.from}>`, 'MAIL FROM', 250);
    await this.command(`RCPT TO:<${message.to}>`, 'RCPT TO', 250);
    await this.command('DATA', 'DATA', 354);
    // A line starting with a dot gets another, so it cannot end the message early.
    const body = message.data.replace(/\r\n$/, '').replace(/^\./gm, '..');
    // Labelled "message", so the body (which may hold a one-time link) never appears in an error.
    await this.command(`${body}\r\n.`, 'message', 250);
    await this.write('QUIT\r\n');
  }

  private async command(line: string, label: string, code: number): Promise<void> {
    await this.write(`${line}\r\n`);
    await this.expect(label, code);
  }

  private write(text: string): Promise<void> {
    return this.writer.write(new TextEncoder().encode(text));
  }

  // A reply is one or more lines; all but the last have a dash after the code ("250-SIZE").
  private async expect(label: string, code: number): Promise<void> {
    const lines: string[] = [];
    for (;;) {
      const line = await this.readLine();
      lines.push(line);
      if (!/^\d{3}-/.test(line)) {
        break;
      }
    }
    const last = lines[lines.length - 1];
    if (Number(last.slice(0, 3)) !== code) {
      throw new Error(`Gmail answered ${label} with: ${lines.join(' ').slice(0, 300)}`);
    }
  }

  private async readLine(): Promise<string> {
    for (;;) {
      const end = this.buffer.indexOf('\r\n');
      if (end >= 0) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 2);
        return line;
      }
      const { value, done } = await this.reader.read();
      if (done) {
        throw new Error('The mail server closed the connection');
      }
      this.buffer += value;
    }
  }
}
