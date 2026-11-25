import { accent } from "./accent";
import { account } from "./account";
import { activity } from "./activity";
import { agents } from "./agents";
import { auth } from "./auth";
import { common } from "./common";
import { data } from "./data";
import { library } from "./library";
import { personalization } from "./personalization";
import { profile } from "./profile";
import { projects } from "./projects";
import { scheduled } from "./scheduled";
import { settings } from "./settings";

/**
 * English source strings for every client, one file per product surface. See
 * docs/development.md#translations before adding one.
 */
export const en = {
  accent,
  account,
  activity,
  agents,
  auth,
  common,
  data,
  library,
  personalization,
  profile,
  projects,
  scheduled,
  settings,
} as const;
