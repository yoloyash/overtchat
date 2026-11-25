import type { Translation } from "../../catalog";

export const settings: Translation["settings"] = {
  general: {
    title: "通用",
    description: "这些偏好设置保存在此浏览器中。",
    messages: {
      title: "消息",
      description: "选择对话中显示哪些信息。",
      expandActivity: {
        title: "展开思考和工具",
        description: "自动展开每条回复的思考过程和工具步骤，无需点击。",
      },
      messageStats: {
        title: "消息统计",
        description: "在助手消息上显示 token 数量和速度统计。",
        toggle: "显示消息统计",
      },
      contextMeter: {
        title: "上下文用量",
        description: "在对话顶栏显示上下文窗口的使用情况。",
        toggle: "显示上下文用量",
      },
      sessionCost: {
        title: "会话费用",
        description: "在对话顶栏显示本次会话的费用。",
        toggle: "显示会话费用",
      },
    },
  },
  appearance: {
    title: "外观",
    description: "选择 OvertChat 的外观和阅读体验。",
    display: {
      title: "显示",
      description: "保存在此设备上。",
    },
    theme: {
      title: "主题",
      description: "使用固定主题，或跟随系统设置。",
      light: "浅色",
      dark: "深色",
      system: "跟随系统",
    },
    accent: {
      title: "强调色",
      description: "为此设备上的界面着色。默认为橄榄绿。",
    },
    font: {
      title: "界面字体",
      description: "选择整个应用使用的字体。",
      system: "系统字体",
    },
    language: {
      title: "语言",
      description: "选择此设备上的界面语言。",
      system: "跟随系统",
    },
  },
  alerts: {
    title: "提醒",
    description: "当对话回复在后台完成时提醒你。仅限此设备，且仅在 OvertChat 打开时有效。",
    descriptionWithAgents:
      "当对话回复在后台完成，或智能体需要你处理、完成或失败时提醒你。仅限此设备，且仅在 OvertChat 打开时有效；否则会通知你的手机。",
    sound: {
      title: "播放提示音",
      description: "回复完成时播放一声简短的提示音。",
      descriptionWithAgents:
        "简短的提示音：智能体需要你处理时音调上扬，智能体或回复完成时音调下降。",
    },
    system: {
      title: "系统通知",
      description: "窗口在后台时显示。",
      descriptionWithAgents: "窗口在后台时显示。窗口在前台时，智能体提醒会改为显示在角落。",
      unsupported: "系统通知需要通过 HTTPS 访问的受支持浏览器，或使用桌面应用。",
      blocked: "请在浏览器或系统设置中允许此网站发送通知，然后重新打开此开关。",
    },
  },
  nav: {
    ariaLabel: "设置",
    pageSelectLabel: "设置页面",
    groups: {
      preferences: "偏好设置",
      account: "账号",
      administration: "管理",
    },
    items: {
      general: "通用",
      personalization: "个性化",
      tools: "工具",
      profile: "个人资料",
      security: "安全",
      data: "数据",
      models: "模型",
      services: "服务",
      agents: "智能体",
      users: "用户",
    },
  },
  pairs: {
    keyLabel: "{{label}} 键 {{index}}",
    valueLabel: "{{label}} 值 {{index}}",
    removeRow: "移除{{label}}行",
  },
};
