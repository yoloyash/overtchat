import "server-only";

export class ProviderConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProviderConfigurationError";
  }
}

export function isProviderConfigurationError(
  error: unknown,
): error is ProviderConfigurationError {
  return error instanceof ProviderConfigurationError;
}
