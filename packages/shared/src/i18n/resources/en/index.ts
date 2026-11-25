import { common } from "./common";
import { accent } from "./accent";
import { settings } from "./settings";
import { agents } from "./agents";
import { scheduled } from "./scheduled";
import { account } from "./account";
import { data } from "./data";
import { personalization } from "./personalization";
import { profile } from "./profile";

/**
 * English source strings for every client, one file per product surface. See
 * docs/development.md#translations before adding one.
 */
export const en = { common, accent, settings, agents, scheduled, account, data, personalization, profile } as const;
