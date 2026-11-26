"use client";

import { useQuery } from "@tanstack/react-query";
import type { VoiceCapability, ImageCapability } from "@overtchat/shared";
import { i18n } from "@overtchat/shared/i18n";
import { apiUrl } from "@/lib/api-url";

interface PublicCapabilitiesResponse {
  capabilities: {
    chatPinning?: boolean;
    chatMarkdownExport?: boolean;
    /** Absent on a server from before scheduled tasks. */
    scheduledTasks?: boolean;
    voice: VoiceCapability;
    images: ImageCapability;
    [key: string]: unknown;
  };
}

export function usePublicCapabilities() {
  return useQuery({
    queryKey: ["capabilities", "public"],
    queryFn: async () => {
      const response = await fetch(apiUrl("/api/capabilities"), { cache: "no-store" });
      if (!response.ok) throw new Error(i18n.t("services.errors.loadCapabilitiesFailed"));
      return (await response.json()) as PublicCapabilitiesResponse;
    },
    staleTime: 30_000,
  });
}
