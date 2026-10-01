import { count } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { user } from "@/lib/db/schema";

/** Public: whether the server still needs its first (administrator) account. */
export async function GET() {
  const [{ n }] = await db.select({ n: count() }).from(user);
  return Response.json(
    { required: n === 0 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
