// An error with the status and message to send back. Anything else thrown is a 500, and its
// details stay in the log.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}
