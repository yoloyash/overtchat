const extraOrigins = new Set(
  (process.env.EXTRA_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

/**
 * Returns the request origin when it belongs to an OvertChat client served
 * from elsewhere: the desktop app (`overtchat://app`), the Expo client, or an
 * operator-configured origin. Same-origin browser requests need no CORS.
 */
export function allowedCorsOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (extraOrigins.has(origin)) return origin;
  if (origin.startsWith("exp://") || origin.startsWith("overtchat://")) return origin;
  return null;
}

export function corsHeaders(origin: string): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Cookie, X-OvertChat-Voice-Ticket",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    // Response headers clients read: the bearer session token on sign-in and
    // stream identity on chat generations.
    "Access-Control-Expose-Headers":
      "set-auth-token, X-OvertChat-Stream-Id, X-OvertChat-Generation",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  });
}
