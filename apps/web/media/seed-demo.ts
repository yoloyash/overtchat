import { demoSetupCode, seedDemo, USER } from "./fixtures";

async function main() {
  const url = process.env.MEDIA_BASE_URL;
  const database = process.env.MEDIA_DATABASE;
  if (!url || !database) throw new Error("Use npm run media:serve to create an isolated demo server.");
  const response = await fetch(`${url}/api/auth/setup-admin`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: url }, body: JSON.stringify({ ...USER, code: await demoSetupCode(url) }),
  });
  if (!response.ok) throw new Error(`Demo signup failed: ${response.status}`);
  seedDemo(database);
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
