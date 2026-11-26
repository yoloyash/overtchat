import { expect, it } from "vitest";
import { formatUpdatedAt } from "@overtchat/shared";
import { i18n } from "@overtchat/shared/i18n";

it("formats recent activity compactly and older activity as a date", () => {
  const now = new Date(2026, 9, 23, 15, 0).getTime();
  const at = (...args: [number, number, number, number, number]) =>
    new Date(...args).getTime();
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  expect(formatUpdatedAt(now - 10_000, i18n.t, locale, now)).toBe("Just now");
  expect(formatUpdatedAt(now - 5 * 60_000, i18n.t, locale, now)).toBe("5m ago");
  expect(formatUpdatedAt(at(2026, 9, 23, 9, 30), i18n.t, locale, now)).toBe("5h ago");
  expect(formatUpdatedAt(at(2026, 9, 22, 23, 0), i18n.t, locale, now)).toBe("Yesterday");
  expect(formatUpdatedAt(at(2026, 9, 20, 12, 0), i18n.t, locale, now)).toBe("3d ago");
  expect(formatUpdatedAt(at(2026, 8, 1, 12, 0), i18n.t, locale, now)).toBe(
    new Date(2026, 8, 1).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
  );
  expect(formatUpdatedAt(at(2025, 8, 1, 12, 0), i18n.t, locale, now)).toContain("2025");
});
