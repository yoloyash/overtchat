import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const databasePath = path.join(
  os.tmpdir(),
  `overtchat-host-connectors-${process.pid}-${Date.now()}.db`,
);
process.env.DATABASE_URL = databasePath;

const raw = new Database(databasePath);
raw.pragma("foreign_keys = ON");
raw.exec(`
  CREATE TABLE user (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT false,
    image TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    role TEXT,
    banned INTEGER DEFAULT false,
    ban_reason TEXT,
    ban_expires INTEGER
  );
  CREATE TABLE host_connectors (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT,
    managed INTEGER NOT NULL DEFAULT false,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    version TEXT,
    last_seen_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX host_connectors_userId_idx
    ON host_connectors (user_id);
  CREATE TABLE host_connector_pairings (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    secret_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX host_connector_pairings_userId_idx
    ON host_connector_pairings (user_id);
`);

let repository: typeof import("./hostConnectors");

beforeAll(async () => {
  repository = await import("./hostConnectors");
});

beforeEach(() => {
  raw.exec(`
    DELETE FROM host_connector_pairings;
    DELETE FROM host_connectors;
    DELETE FROM user;
    INSERT INTO user (id, name, email, role, created_at) VALUES
      ('alice', 'Alice', 'alice@example.com', 'admin', 1),
      ('bob', 'Bob', 'bob@example.com', 'user', 2);
  `);
});

afterAll(() => {
  raw.close();
  fs.rmSync(databasePath, { force: true });
});

describe("Host Connector pairing", () => {
  it("consumes a pairing once and authenticates only the issued token", () => {
    const pairing = repository.createHostConnectorPairing("alice");

    expect(
      repository.consumeHostConnectorPairing({
        pairCode: `${pairing.pairCode}wrong`,
        name: "Alice host",
        version: "0.1.0",
      }),
    ).toBeNull();

    const paired = repository.consumeHostConnectorPairing({
      pairCode: pairing.pairCode,
      name: "Alice host",
      version: "0.1.0",
    });
    expect(paired).not.toBeNull();
    expect(repository.authenticateHostConnectorToken(paired!.token)).toMatchObject({
      id: paired!.connector.id,
      userId: "alice",
      name: "Alice host",
      version: "0.1.0",
    });
    expect(
      repository.consumeHostConnectorPairing({
        pairCode: pairing.pairCode,
        name: "Replay",
        version: null,
      }),
    ).toBeNull();
  });

  it("rotates the token while preserving the connector identity", () => {
    const firstPairing = repository.createHostConnectorPairing("alice");
    const first = repository.consumeHostConnectorPairing({
      pairCode: firstPairing.pairCode,
      name: "Old name",
      version: "0.1.0",
    })!;
    const secondPairing = repository.createHostConnectorPairing("alice");
    const second = repository.consumeHostConnectorPairing({
      pairCode: secondPairing.pairCode,
      name: "New name",
      version: "0.2.0",
    })!;

    expect(second.connector.id).toBe(first.connector.id);
    expect(repository.authenticateHostConnectorToken(first.token)).toBeNull();
    expect(repository.authenticateHostConnectorToken(second.token)).toMatchObject({
      id: first.connector.id,
      name: "New name",
    });
    expect(repository.getOwnedHostConnector(first.connector.id, "bob")).toBeNull();
    expect(repository.listHostConnectors("alice")).toHaveLength(1);
  });

  it("rejects expired pairings", () => {
    const pairing = repository.createHostConnectorPairing("alice");
    raw.prepare("UPDATE host_connector_pairings SET expires_at = 0").run();

    expect(
      repository.consumeHostConnectorPairing({
        pairCode: pairing.pairCode,
        name: "Expired",
        version: null,
      }),
    ).toBeNull();
  });
});

describe("managed Host Connector", () => {
  it("can be provisioned before signup and claimed by the first admin", () => {
    raw.exec("DELETE FROM user");
    const provisioned = repository.provisionManagedHostConnector({
      name: "Setup host",
      version: "0.4.0",
    });

    expect(provisioned.connector).toMatchObject({
      userId: null,
      managed: true,
      name: "Setup host",
    });
    raw.prepare(
      "INSERT INTO user (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("owner", "Owner", "owner@example.com", "admin", 1);
    repository.claimManagedHostConnector("owner");

    expect(repository.getManagedHostConnector()).toMatchObject({
      id: provisioned.connector.id,
      userId: "owner",
      managed: true,
    });
    expect(repository.authenticateHostConnectorToken(provisioned.token))
      .toMatchObject({ id: provisioned.connector.id });
  });

  it("adopts an existing admin connector and rotates its credentials", () => {
    const pairing = repository.createHostConnectorPairing("alice");
    const legacy = repository.consumeHostConnectorPairing({
      pairCode: pairing.pairCode,
      name: "Legacy host",
      version: "0.3.4",
    })!;
    const managed = repository.provisionManagedHostConnector({
      name: "Managed host",
      version: "0.4.0",
    });

    expect(managed.connector).toMatchObject({
      id: legacy.connector.id,
      userId: "alice",
      managed: true,
      name: "Managed host",
      version: "0.4.0",
    });
    expect(repository.authenticateHostConnectorToken(legacy.token)).toBeNull();
    expect(repository.authenticateHostConnectorToken(managed.token))
      .toMatchObject({ id: legacy.connector.id });
    expect(repository.listHostConnectors("alice")).toHaveLength(1);
  });
});
