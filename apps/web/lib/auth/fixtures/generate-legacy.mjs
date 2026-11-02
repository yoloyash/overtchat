// Run with a separate workspace that still has better-auth@1.6.23 installed:
// node lib/auth/fixtures/generate-legacy.mjs /path/to/old/apps/web
// All credentials below are synthetic test data, never a real installation.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

if (!process.argv[2]) throw new Error("Pass the old web workspace directory.");
const requireLegacy = createRequire(
  path.join(path.resolve(process.argv[2]), "package.json"),
);
const packagePath = path.resolve(
  path.dirname(requireLegacy.resolve("better-auth")),
  "../package.json",
);
const { version } = JSON.parse(await readFile(packagePath, "utf8"));
if (version !== "1.6.23")
  throw new Error(`Expected Better Auth 1.6.23, found ${version}`);
const load = (name) => import(pathToFileURL(requireLegacy.resolve(name)).href);
const { betterAuth } = await load("better-auth");
const { memoryAdapter } = await load("better-auth/adapters/memory");
const { admin, bearer } = await load("better-auth/plugins");
const store = { user: [], session: [], account: [], verification: [] };
const secret = "upgrade-fixture-secret-not-for-production-12345";
const password = "upgrade-fixture-password-123";
const auth = betterAuth({
  baseURL: "http://localhost:4717",
  secret,
  database: memoryAdapter(store),
  emailAndPassword: { enabled: true },
  plugins: [admin({ defaultRole: "admin" }), bearer()],
  session: { expiresIn: 60 * 60 * 24 * 365 },
});
const response = await auth.handler(
  new Request("http://localhost:4717/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:4717",
    },
    body: JSON.stringify({
      name: "Existing Owner",
      email: "upgrade@example.test",
      password,
    }),
  }),
);
if (response.status !== 200)
  throw new Error(`Fixture generation failed: ${response.status}`);
const fixture = {
  version,
  secret,
  password,
  cookie: response.headers.get("set-cookie").split(";")[0],
  bearer: response.headers.get("set-auth-token"),
  user: store.user[0],
  account: store.account[0],
  session: store.session[0],
};
await writeFile(
  new URL("./better-auth-1.6.23.json", import.meta.url),
  `${JSON.stringify(fixture, null, 2)}\n`,
);
console.log("Generated synthetic Better Auth 1.6.23 compatibility fixture.");
