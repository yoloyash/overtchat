import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { cjk } from "@streamdown/cjk";
import { defaultRemarkPlugins } from "streamdown";

export const STREAMDOWN_PLUGINS = { code, math, cjk };

export const STREAMDOWN_DEFAULT_REMARK_PLUGINS = Object.values(defaultRemarkPlugins);
