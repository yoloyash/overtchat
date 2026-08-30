"use client";

import { useQuery } from "@tanstack/react-query";
import type { VoiceCapability } from "@overtchat/shared";

interface PublicCapabilitiesResponse {
  capabilities: {
    voice: VoiceCapability;
    [key: string]: unknown;
  };
}

export function usePublicCapabilities() {
  return useQuery({
    queryKey: ["capabilities", "public"],
    queryFn: async () => {
      const response = await fetch("/api/capabilities", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load server capabilities.");
      return (await response.json()) as PublicCapabilitiesResponse;
    },
    staleTime: 30_000,
  });
}
