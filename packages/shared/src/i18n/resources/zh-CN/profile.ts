import type { Translation } from "../../catalog";

export const profile: Translation["profile"] = {
  title: "个人资料",
  description: "选择你在此服务器上向他人展示的方式。",
  viewActivity: "查看活跃度主页",
  identity: {
    title: "身份信息",
    description: "你的个人资料会显示在排行榜和活跃度页面上。",
  },
  preview: {
    title: "预览",
    description: "编辑时会实时更新。",
    subtitle: "活跃度主页",
  },
  displayName: {
    title: "显示名称",
    description: "使用他人能够认出你的名称。",
  },
  avatarUrl: {
    title: "头像链接",
    description: "选填。请使用图片的直接链接。",
  },
  updated: "个人资料已更新",
  saving: "正在保存…",
  save: "保存个人资料",
  errors: {
    nameRequired: "必须填写显示名称。",
    invalidAvatarUrl: "头像链接必须以 http:// 或 https:// 开头。",
    updateFailed: "更新个人资料失败。",
  },
};
