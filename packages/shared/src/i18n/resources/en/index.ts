import { accent } from "./accent";
import { activity } from "./activity";
import { agents } from "./agents";
import { auth } from "./auth";
import { common } from "./common";
import { library } from "./library";
import { projects } from "./projects";
import { scheduled } from "./scheduled";
import { settings } from "./settings";

/**
 * English source strings for every client, one file per product surface. See
 * docs/development.md#translations before adding one.
 */
export const en = {
  accent,
  activity,
  agents,
  auth,
  common,
  library,
  projects,
  scheduled,
  settings,
} as const;
