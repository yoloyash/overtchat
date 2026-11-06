/**
 * A failure with a message meant for the person connecting the account and
 * the HTTP status its route should answer with.
 */
export class IntegrationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The provider's own error code, when the caller needs to branch on it. */
    readonly code?: string,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

/** The stored grant is dead; the user has to sign in again. */
export class IntegrationReconnectError extends IntegrationError {
  constructor(message = "This account needs to be reconnected in Settings.") {
    super(message, 409, "needs_reconnect");
    this.name = "IntegrationReconnectError";
  }
}
