import type { Translation } from "../../catalog";

export const activity: Translation["activity"] = {
  periods: {
    "7d": "7 天",
    "30d": "30 天",
    all: "全部时间",
  },
  metrics: {
    loading: "正在加载",
    chatTokens: "对话 token",
    responses: "回复数",
    activePeople: "活跃成员",
    input: "输入",
    output: "输出",
  },
  leaderboard: {
    title: "排行榜",
    trackingSince: "自 {{date}} 起统计",
    waitingForTracking: "等待首条统计回复",
    periodLabel: "排行榜时间范围",
    people: "成员",
    rankedByChatTokens: "按对话 token 排名",
    columns: {
      rank: "排名",
      person: "成员",
    },
    loadError: "无法加载活动数据。",
    empty: "此时间段内暂无活动记录。",
    rankLabel: "第 {{rank}} 名",
    responsesCompact: "{{responses}} 条回复",
    chatTokensTitle: "{{tokens}} 个对话 token",
  },
  profile: {
    loadError: "无法加载此活动档案。",
    returnToLeaderboard: "返回排行榜",
    memberSince: "加入于 {{date}}",
    tokenActivity: "token 活动",
    trackedSince: "自 {{date}} 起统计",
    noTrackedResponses: "暂无已统计的回复",
    pastYear: "过去 365 天",
    models: {
      title: "模型",
      description: "各模型在全部回复中的占比",
      used_other: "已使用 {{count}} 个",
      empty: "暂无模型活动记录。",
      responsesLabel: "条回复",
    },
  },
  heatmap: {
    gridLabel: "{{name}} 过去一年的 token 活动",
    dayLabel: "{{date}}：{{tokens}} 个对话 token，{{responses}} 条回复",
    tooltipTokens: "{{date}} 共 {{tokens}} 个 token",
    tooltipResponses_other: "{{formatted}} 条回复",
  },
};
