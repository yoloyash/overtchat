import { expect, type Page } from "@playwright/test";

/**
 * Localhost is a secure context even over plain HTTP. Remove the
 * secure-context-only `crypto.randomUUID` before every navigation to
 * reproduce a plain-HTTP LAN origin such as `http://homelab:4718`.
 */
export async function removeRandomUuid(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });
  });
}

/** The page replaced the removed browser API with the app's fallback. */
export async function expectRandomUuidFallback(page: Page) {
  const { source, value } = await page.evaluate(() => ({
    source: String(crypto.randomUUID),
    value: crypto.randomUUID(),
  }));
  expect(source).not.toContain("[native code]");
  expect(value).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
}
