import "server-only";

export class GoogleOAuthError extends Error {
  constructor(
    message: string,
    public status = 503,
    public reconnect = false,
  ) {
    super(message);
  }
}
