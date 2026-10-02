"use client";

import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";
import { getApiOrigin } from "@/lib/api-url";

export const authClient = createAuthClient({
  // Same-origin on the web. Bundled clients set the server before loading this.
  baseURL: getApiOrigin() || undefined,
  plugins: [adminClient()],
});
