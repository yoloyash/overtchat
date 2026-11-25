import type { Translation } from "../../catalog";

export const services: Translation["services"] = {
  page: {
    title: "服务",
    description:
      "管理此服务器的搜索和语音服务商。本地服务可通过 overtchat setup 安装。",
    loading: "正在加载服务…",
    loadError: "无法加载服务器服务。",
  },
  capabilities: {
    search: {
      title: "联网搜索",
      description: "选择 OvertChat 优先尝试的服务商。",
      providerLabel: "联网搜索服务商",
      updatedTitle: "联网搜索已更新",
      updateErrorTitle: "无法更新联网搜索",
      providers: {
        bundled: "内置 SearXNG",
        brave: "Brave Search API",
        searxng: "现有 SearXNG",
        disabled: "已停用",
      },
    },
    tts: {
      title: "文字转语音",
      description: "选择此服务器上所有人使用的服务商。",
      providerLabel: "文字转语音服务商",
      updatedTitle: "文字转语音已更新",
      updateErrorTitle: "无法更新文字转语音",
      providers: {
        bundled: "内置 Kokoro",
        "openai-compatible": "OpenAI 兼容 API",
        disabled: "已停用",
      },
    },
    stt: {
      title: "语音转文字",
      description: "选择此服务器上所有人使用的服务商。",
      providerLabel: "语音转文字服务商",
      updatedTitle: "语音转文字已更新",
      updateErrorTitle: "无法更新语音转文字",
      providers: {
        bundled: "内置 Parakeet",
        "openai-compatible": "OpenAI 兼容 API",
        disabled: "已停用",
      },
    },
  },
  fields: {
    providerTitle: "服务商",
    bundledMissingDescription:
      "此服务器未安装{{provider}}。请运行：overtchat setup",
    providerOptionNotInstalled: "{{provider}} — 未安装",
    apiBaseUrlTitle: "API 基础 URL",
    apiKeyTitle: "API 密钥",
    apiKeyConfiguredDescription: "已配置密钥。留空以保留现有密钥。",
    searchOrderTitle: "搜索顺序",
    searchOrderDescription:
      "如果首选服务商失败，OvertChat 会尝试免费搜索服务商。",
    modelTitle: "模型",
    defaultVoiceTitle: "默认音色",
  },
  actions: {
    testing: "测试中…",
    testConnection: "测试连接",
    saving: "正在保存…",
    save: "保存",
  },
  errors: {
    updateUnchanged: "服务商未更改。",
    connectFailed: "无法连接到服务商。",
    loadCapabilitiesFailed: "无法加载服务器能力。",
    serviceRequestFailed: "无法完成服务请求。",
  },
  voice: {
    title: "实时语音",
    description:
      "使用上方的语音服务商和所选对话模型进行可打断的实时语音对话。",
    statusTitle: "状态",
    configuredLabel: "已配置",
    configuredDescription: "此服务器已支持实时语音对话。",
    notInstalledLabel: "未安装",
    notInstalledDescription: "请运行 overtchat setup 并启用实时语音对话。",
    needsSttLabel: "需要语音转文字",
    needsSttDescription: "请在上方选择一个语音转文字服务商。",
    needsTtsLabel: "需要文字转语音",
    needsTtsDescription: "请在上方选择一个文字转语音服务商。",
    incompleteSetupLabel: "配置不完整",
    incompleteSetupDescription: "请运行 overtchat setup 以修复实时语音配置。",
  },
};
