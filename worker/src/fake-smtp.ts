import type { Connect } from './smtp';

// A stand-in for Gmail's mail server in tests. It answers each command as Gmail does, records the
// conversation, and can be told to refuse one command.

export interface FakeSmtp {
  open: Connect;
  /** Every command line received, with the message itself as one entry. */
  commands: string[];
  /** The message as received after DATA, with dot-stuffing removed. */
  message: () => string;
  host?: string;
  port?: number;
  closed: boolean;
}

export function fakeSmtp(
  options: { refuse?: { command: string; reply: string }; silent?: boolean } = {},
): FakeSmtp {
  const fake: FakeSmtp = {
    open: undefined as unknown as Connect,
    commands: [],
    message: () => '',
    closed: false,
  };
  let received = '';

  fake.open = (host, port) => {
    fake.host = host;
    fake.port = port;
    const toServer = new TransformStream<Uint8Array, Uint8Array>();
    const toClient = new TransformStream<Uint8Array, Uint8Array>();
    const writer = toClient.writable.getWriter();
    const reply = (text: string) => writer.write(new TextEncoder().encode(`${text}\r\n`));

    void (async () => {
      if (options.silent) {
        return;
      }
      await reply('220 smtp.gmail.com ESMTP ready');
      const reader = toServer.readable.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      let inData = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          return;
        }
        buffer += value;
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) {
            continue;
          }
          received = buffer.slice(0, end + 2).replace(/^\.\./gm, '.');
          fake.commands.push('<message>');
          buffer = buffer.slice(end + 5);
          inData = false;
          await answer('<message>', '250 2.0.0 OK queued');
          continue;
        }
        let end: number;
        while ((end = buffer.indexOf('\r\n')) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          fake.commands.push(line);
          const verb = line.split(/[ :]/)[0];
          if (verb === 'EHLO') {
            await reply('250-smtp.gmail.com at your service');
            await answer('EHLO', '250 AUTH LOGIN PLAIN');
          } else if (verb === 'AUTH') {
            await answer('AUTH', '235 2.7.0 Accepted');
          } else if (verb === 'MAIL' || verb === 'RCPT') {
            await answer(verb, '250 2.1.0 OK');
          } else if (verb === 'DATA') {
            if (await answer('DATA', '354 Go ahead')) {
              inData = true;
              break;
            }
          } else if (verb === 'QUIT') {
            await reply('221 2.0.0 closing connection');
          }
        }
      }
    })();

    // Answers with the refusal instead when this is the command to refuse; true if it went ahead.
    async function answer(command: string, ok: string): Promise<boolean> {
      if (options.refuse?.command === command) {
        await reply(options.refuse.reply);
        return false;
      }
      await reply(ok);
      return true;
    }

    return {
      readable: toClient.readable,
      writable: toServer.writable,
      close: async () => {
        fake.closed = true;
      },
    };
  };
  fake.message = () => received;
  return fake;
}
