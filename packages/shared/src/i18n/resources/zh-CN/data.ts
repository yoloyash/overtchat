import type { Translation } from "../../catalog";

export const data: Translation["data"] = {
  title: "数据",
  description: "从其他平台导入对话，或导出你自己的对话。",
  import: {
    title: "导入",
    description: "支持 ChatGPT、Claude.ai、OpenWebUI 和 overtchat 导出文件。",
    fileTitle: "导入文件",
    fileDescription:
      "选择已下载的 JSON 或 ZIP 文件。导入会保留可见的对话文本和推理过程，但不包含附件、图片或分支。",
    importing: "正在导入…",
    chooseFile: "选择文件",
    failedWithStatus: "导入失败（{{status}}）",
    failed: "导入失败。",
    completeTitle: "导入完成",
    completeChats_other: "已从 {{format}} 导入 {{count}} 个对话。",
    completeWithMemories: "已从 {{format}} 导入 {{chats}}和 {{memories}}。",
    chatCount_other: "{{count}} 个对话",
    memoryCount_other: "{{count}} 条记忆",
  },
  export: {
    title: "导出",
    description: "将所有对话下载为单个 overtchat JSON 文件。",
    fileTitle: "导出文件",
    fileDescription: "此文件可用于备份或无损重新导入。",
    download: "下载导出文件",
  },
  sharedChats: {
    title: "已分享的对话",
    description: "管理对话的公开链接。",
    loading: "正在加载已分享的对话…",
    updated: "更新于 {{date}}",
    unshare: "取消分享",
    empty: "没有已分享的对话。",
  },
};
