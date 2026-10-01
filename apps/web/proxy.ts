import { NextResponse, type NextRequest } from "next/server";
import { allowedCorsOrigin, corsHeaders } from "@/lib/cors";

/** Applies CORS to every API route for OvertChat clients on other origins. */
export function proxy(request: NextRequest) {
  const origin = allowedCorsOrigin(request.headers.get("origin"));
  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: origin ? corsHeaders(origin) : undefined,
    });
  }
  const response = NextResponse.next();
  if (origin) {
    corsHeaders(origin).forEach((value, key) => response.headers.set(key, value));
  }
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
