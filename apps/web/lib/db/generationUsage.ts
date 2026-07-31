import "server-only";
import { db } from "@/lib/db/client";
import {
  generationUsage,
  type NewGenerationUsageRow,
} from "@/lib/db/schema";

export function tryRecordGenerationUsage(
  values: NewGenerationUsageRow,
): boolean {
  try {
    db.insert(generationUsage).values(values).run();
    return true;
  } catch (error) {
    console.error("[generation-usage]", error);
    return false;
  }
}
