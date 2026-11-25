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
  mobile: {
    export: {
      description: "将你的对话保存为 OvertChat JSON 文件，以便备份或重新导入。",
      action: "导出对话",
      failedWithStatus: "无法导出对话（{{status}}）。",
      saved: "导出文件已保存到所选文件夹。",
    },
    import: {
      description:
        "支持 ChatGPT、Claude.ai、OpenWebUI 和 OvertChat 的 JSON 或 ZIP 导出文件，最大 50 MB。会保留可见文本和推理过程；不会导入附件、图片和分支。",
      chooseFile: "选择导入文件",
      tooLarge: "导入文件不能超过 50 MB。",
      confirmTitle: "导入对话？",
      confirmMessage: "将 {{name}} 导入你的账号？重复导入同一文件可能会产生重复内容。",
      complete: "已导入 {{chats}}、{{messages}}和 {{memories}}。",
      messageCount_other: "{{count}} 条消息",
    },
  },
};
