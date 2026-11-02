const origin = `http://localhost:${process.env.E2E_PORT ?? "4717"}`;

/**
 * Browser storage that has already shown the one-time two-factor prompt, so
 * it doesn't cover the page in tests about something else.
 */
export function promptedOrigins() {
  return [
    {
      origin,
      localStorage: [{ name: "overtchat_two_factor_prompted", value: "e2e" }],
    },
  ];
}
