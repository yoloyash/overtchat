import type { Translation } from "../../catalog";

export const personalization: Translation["personalization"] = {
  title: "个性化",
  description: "向 OvertChat 介绍你自己，并管理它在对话之间记住的内容。",
  loading: "正在加载个性化设置…",
  loadError: "无法加载个性化设置。",
  profile: {
    title: "关于你",
    description: "这些字段只能在此处修改。留空的字段不会添加到模型上下文中。",
    enabled: {
      title: "启用个性化",
      description:
        "在对话中包含你的个人资料和已保存的记忆，并允许模型在你要求时管理记忆。临时对话绝不使用个性化。",
    },
    preferredName: {
      title: "常用称呼",
      description: "希望 OvertChat 怎么称呼你？",
    },
    occupation: {
      title: "职业",
    },
    about: {
      title: "更多关于你的信息",
      description: "希望记住的兴趣、价值观或偏好。",
    },
    optionalPlaceholder: "选填",
    save: "保存",
    saving: "正在保存…",
    savedToast: "个性化设置已保存",
    saveError: "保存个性化设置失败。",
  },
  memories: {
    title: "已保存的记忆",
    description:
      "当你明确要求模型记住或忘记某些内容时，模型可以添加、更新或删除这些条目。你的个人资料和记忆共享 4 KiB 上下文预算。",
    usageTooltip:
      "已使用 {{bytes}} / {{limit}} 字节上下文（含个人资料）· {{entries}} / {{entryLimit}} 条记忆",
    usageBadge: "已使用 {{percent}}%",
    clearedToast: "记忆已清空",
    add: "添加记忆",
    searchPlaceholder: "搜索记忆",
    emptyTitle: "还没有保存的记忆",
    emptyDescription: "可以让 OvertChat 记住某些信息，或者手动添加。",
    noMatches: "没有与 <query>{{query}}</query> 匹配的记忆。",
    updated: "更新于 {{date}}",
    editAriaLabel: "编辑 {{key}}",
    editTitle: "编辑记忆",
    dialog: {
      editTitle: "编辑记忆",
      addTitle: "添加记忆",
      description: "开启个性化后，已保存的记忆会包含在后续对话中。",
      valueLabel: "希望 OvertChat 记住什么？",
      valueAriaLabel: "记忆内容",
      valuePlaceholder: "偏好简洁的回答。",
      keyLabel: "标签",
      keyAriaLabel: "记忆键名",
      keyHint:
        "用于之后更新这条记忆。请以字母开头，仅使用小写字母、数字或下划线。",
      cancel: "取消",
      saving: "正在保存…",
      saveChanges: "保存更改",
      addSubmit: "添加记忆",
      updatedToast: "记忆已更新",
      addedToast: "记忆已添加",
      updateError: "更新记忆失败。",
      addError: "添加记忆失败。",
    },
    deleteDialog: {
      ariaLabel: "删除 {{key}}",
      buttonTitle: "删除记忆",
      title: "删除这条记忆？",
      description: "OvertChat 将不再在后续对话中包含这条记忆。",
      cancel: "取消",
      deleting: "正在删除…",
      confirm: "删除",
      deletedToast: "记忆已删除",
      error: "删除记忆失败。",
    },
    clearDialog: {
      trigger: "全部清空",
      title: "清空所有记忆？",
      description:
        "这会永久删除所有已保存的记忆。你的个人资料字段不受影响。",
      cancel: "取消",
      clearing: "正在清空…",
      confirm: "全部清空",
      error: "清空记忆失败。",
    },
  },
};
