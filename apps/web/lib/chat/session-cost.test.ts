import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_COST_ENABLED,
  SESSION_COST_STORAGE_KEY,
} from "./session-cost";

describe("session cost preference", () => {
  it("defaults to visible", () => {
    expect(DEFAULT_SESSION_COST_ENABLED).toBe(true);
    expect(SESSION_COST_STORAGE_KEY).toBe("overtchat_session_cost");
  });
});
