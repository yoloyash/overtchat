import { getSetupCode } from "@/lib/db/initialSetup";

/** Public: setup state only. The code is restricted to operator management. */
export async function GET() {
  return Response.json(
    { required: getSetupCode() !== null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
