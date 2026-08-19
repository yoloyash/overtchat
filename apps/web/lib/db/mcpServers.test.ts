import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invalidateMcpServer: vi.fn().mockResolvedValue(undefined),
  invalidateUserMcpServer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mcp/manager", () => ({
  invalidateMcpServer: mocks.invalidateMcpServer,
  invalidateUserMcpServer: mocks.invalidateUserMcpServer,
}));

const databasePath = path.join(
  os.tmpdir(),
  `overtchat-mcp-servers-${process.pid}-${Date.now()}.db`,
);
process.env.DATABASE_URL = databasePath;

const raw = new Database(databasePath);
raw.exec(`
  CREATE TABLE user (
    id TEXT PRIMARY KEY NOT NULL
  );
  CREATE TABLE mcp_servers (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    availability TEXT DEFAULT 'everyone' NOT NULL,
    config TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  );
  CREATE TABLE user_mcp_server_preferences (
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    enabled INTEGER DEFAULT true NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    PRIMARY KEY (user_id, server_id)
  );
`);

let repository: typeof import("./mcpServers");

beforeAll(async () => {
  repository = await import("./mcpServers");
});

beforeEach(() => {
  vi.clearAllMocks();
  raw.exec(`
    DELETE FROM user_mcp_server_preferences;
    DELETE FROM mcp_servers;
    DELETE FROM user;
    INSERT INTO user (id) VALUES ('user'), ('admin');
    INSERT INTO mcp_servers (id, name, availability, config)
    VALUES (
      'reference',
      'Reference',
      'everyone',
      '{"transport":"http","url":"https://mcp.example.test","headers":{}}'
    ), (
      'admin-reference',
      'Admin Reference',
      'admins',
      '{"transport":"http","url":"https://admin.example.test","headers":{}}'
    ), (
      'disabled-reference',
      'Disabled Reference',
      'disabled',
      '{"transport":"http","url":"https://disabled.example.test","headers":{}}'
    );
  `);
});

afterAll(() => {
  raw.close();
  fs.rmSync(databasePath, { force: true });
});

describe("MCP server connection invalidation", () => {
  it("closes the previous connection after an update", async () => {
    await repository.updateMcpServer("reference", {
      name: "Updated Reference",
      availability: "everyone",
      config: {
        transport: "http",
        url: "https://updated.example.test/mcp",
        headers: {},
      },
    });

    expect(mocks.invalidateMcpServer).toHaveBeenCalledOnce();
    expect(mocks.invalidateMcpServer).toHaveBeenCalledWith("reference", {
      disconnect: true,
    });
  });

  it("closes the connection after deletion", async () => {
    await repository.deleteMcpServer("reference");

    expect(mocks.invalidateMcpServer).toHaveBeenCalledOnce();
    expect(mocks.invalidateMcpServer).toHaveBeenCalledWith("reference");
  });

  it("reprojects a rename without disconnecting the server", async () => {
    await repository.updateMcpServer("reference", {
      name: "Renamed Reference",
      availability: "everyone",
      config: {
        transport: "http",
        url: "https://mcp.example.test",
        headers: {},
      },
    });

    expect(mocks.invalidateMcpServer).toHaveBeenCalledWith("reference", {
      disconnect: false,
    });
  });

  it("disconnects the server when its audience changes", async () => {
    await repository.updateMcpServer("reference", {
      name: "Reference",
      availability: "admins",
      config: {
        transport: "http",
        url: "https://mcp.example.test",
        headers: {},
      },
    });

    expect(mocks.invalidateMcpServer).toHaveBeenCalledWith("reference", {
      disconnect: true,
    });
  });
});

describe("MCP server visibility and preferences", () => {
  it("shows regular users only everyone servers", async () => {
    await expect(
      repository.listAvailableMcpServers("user", "user"),
    ).resolves.toEqual([
      { id: "reference", name: "Reference", enabled: true },
    ]);
  });

  it("shows admins everyone and admin-only servers but never disabled servers", async () => {
    await expect(
      repository.listAvailableMcpServers("admin", "admin"),
    ).resolves.toEqual([
      { id: "admin-reference", name: "Admin Reference", enabled: true },
      { id: "reference", name: "Reference", enabled: true },
    ]);
  });

  it("defaults missing preferences to enabled and omits personally disabled servers at runtime", async () => {
    await repository.setMcpServerPreference(
      "user",
      "user",
      "reference",
      false,
    );

    await expect(
      repository.listAvailableMcpServers("user", "user"),
    ).resolves.toEqual([
      { id: "reference", name: "Reference", enabled: false },
    ]);
    await expect(
      repository.listEffectiveMcpServers("user", "user"),
    ).resolves.toEqual([]);
    expect(mocks.invalidateUserMcpServer).toHaveBeenCalledWith(
      "user",
      "reference",
    );
  });

  it("does not let a user create a preference for an unauthorized server", async () => {
    await expect(
      repository.setMcpServerPreference(
        "user",
        "user",
        "admin-reference",
        true,
      ),
    ).resolves.toBeNull();

    expect(mocks.invalidateUserMcpServer).not.toHaveBeenCalled();
    expect(
      raw
        .prepare("SELECT count(*) AS count FROM user_mcp_server_preferences")
        .get(),
    ).toEqual({ count: 0 });
  });
});
