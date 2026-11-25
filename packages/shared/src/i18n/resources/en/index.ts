import { accent } from "./accent";
import { account } from "./account";
import { activity } from "./activity";
import { agents } from "./agents";
import { auth } from "./auth";
import { common } from "./common";
import { data } from "./data";
import { library } from "./library";
import { models } from "./models";
import { personalization } from "./personalization";
import { profile } from "./profile";
import { projects } from "./projects";
import { scheduled } from "./scheduled";
import { services } from "./services";
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
  models,
  personalization,
  profile,
  projects,
  scheduled,
  services,
  settings,
} as const;
