import { accent } from "./accent";
import { agents } from "./agents";
import { auth } from "./auth";
import { common } from "./common";
import { projects } from "./projects";
import { scheduled } from "./scheduled";
import { settings } from "./settings";

/**
 * English source strings for every client, one file per product surface. See
 * docs/development.md#translations before adding one.
 */
export const en = {
  accent,
  agents,
  auth,
  common,
  projects,
  scheduled,
  settings,
} as const;
