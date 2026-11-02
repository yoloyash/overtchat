import { managementRequestAuthorized } from "@/lib/management/auth";
import { getSetupCode } from "@/lib/db/initialSetup";

export async function GET(request: Request) {
  if (!managementRequestAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const code = getSetupCode();
  return Response.json({ required: code !== null, code }, {
    headers: { "Cache-Control": "no-store" },
  });
}
