import {
  DEFAULT_WEB_SEARCH_ENABLED,
  WEB_SEARCH_ENABLED_STORAGE_KEY,
} from "@overtchat/shared";
import { useSecureFlag } from "@/lib/useSecureFlag";

export function useWebSearchEnabled(): [boolean, (value: boolean) => void] {
  return useSecureFlag(
    WEB_SEARCH_ENABLED_STORAGE_KEY,
    DEFAULT_WEB_SEARCH_ENABLED,
  );
}
