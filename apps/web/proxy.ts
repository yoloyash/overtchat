import { NextResponse, type NextRequest } from "next/server";
import { allowedCorsOrigin, corsHeaders } from "@/lib/cors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether a browser sent this write from another site. SameSite cookies don't
 * cover sibling subdomains (other servers under a shared domain count as the
 * same site), so writes must come from this origin or an OvertChat client.
 * Requests without browser markers, like native apps and the CLI, pass.
 */
function crossSiteWrite(request: NextRequest, corsOrigin: string | null): boolean {
  if (SAFE_METHODS.has(request.method) || corsOrigin) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  // Browsers omit Sec-Fetch-Site on plain-HTTP origins; fall back to Origin.
  const origin = request.headers.get("origin");
  if (!origin) return false;
  if (origin === "null") return true;
  const hosts = [request.headers.get("x-forwarded-host"), request.headers.get("host")];
  try {
    return !hosts.includes(new URL(origin).host);
  } catch {
    return true;
  }
}

/** Applies CORS to every API route and refuses cross-site browser writes. */
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/share/")) {
    const response = NextResponse.next();
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  const origin = allowedCorsOrigin(request.headers.get("origin"));
  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: origin ? corsHeaders(origin) : undefined,
    });
  }
  if (crossSiteWrite(request, origin)) {
    return NextResponse.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
  }
  const response = NextResponse.next();
  if (origin) {
    corsHeaders(origin).forEach((value, key) => response.headers.set(key, value));
  }
  return response;
}

export const config = {
  matcher: ["/api/:path*", "/share/:path*"],
};
