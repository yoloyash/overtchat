import { randomUuid } from "./uuid";

// Browsers only expose crypto.randomUUID in secure contexts, and self-hosted
// servers are often opened over plain-HTTP LAN origins. Our code and its
// dependencies call it directly, so UI entry points import this module first.
if (typeof crypto.randomUUID !== "function") {
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    writable: true,
    value: randomUuid,
  });
}
