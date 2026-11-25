import type { Translation } from "../../catalog";

export const agents: Translation["agents"] = {
  refresh: {
    failedTitle: "无法刷新会话",
    failedFallback: "刷新失败。",
    partialTitle: "会话已刷新，但有部分错误",
    successTitle: "会话已刷新",
    synced_other: "已同步 {{count}} 个智能体工作区。",
    syncedWithFailures_other: "已同步 {{count}} 个智能体工作区；{{failed}} 个失败。",
  },
};
