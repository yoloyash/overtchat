import { common } from "./common";
import { accent } from "./accent";
import { settings } from "./settings";
import { agents } from "./agents";
import { scheduled } from "./scheduled";
import { chat } from "./chat";

/**
 * English source strings for every client, one file per product surface. See
 * docs/development.md#translations before adding one.
 */
export const en = { common, accent, settings, agents, scheduled, chat } as const;
