import type { Translation } from "../../catalog";

export const common: Translation["common"] = {
  relativeTime: {
    justNow: "刚刚",
    justNowInline: "刚刚",
    minutesAgo: "{{minutes}} 分钟前",
    hoursAgo: "{{hours}} 小时前",
    yesterday: "昨天",
    yesterdayInline: "昨天",
    daysAgo: "{{days}} 天前",
  },
  errors: {
    generic: "出错了，请重试。",
    signInRequired: "请先登录以继续。",
    permissionDenied: "你没有权限执行此操作。",
    tooManyRequests: "请求过于频繁，请稍后重试。",
    requestFailed: "无法完成请求，请重试。",
    speech: {
      stt: {
        disabled: "此服务器已关闭语音输入。",
        notConfigured: "此服务器尚未配置语音输入。",
        unreachable: "无法连接转写服务，请稍后重试。",
        timeout: "转写服务响应超时，请重试。",
        providerAuth: "转写服务拒绝了服务器凭据，请联系管理员检查语音设置。",
        rateLimited: "转写服务繁忙，请稍后重试。",
        invalidResponse: "转写服务返回了无效响应，请重试。",
        unavailable: "转写服务暂时不可用，请稍后重试。",
      },
      tts: {
        disabled: "此服务器已关闭朗读功能。",
        notConfigured: "此服务器尚未配置朗读功能。",
        unreachable: "无法连接语音播放服务，请稍后重试。",
        timeout: "语音播放服务响应超时，请重试。",
        providerAuth:
          "语音播放服务拒绝了服务器凭据，请联系管理员检查语音设置。",
        rateLimited: "语音播放服务繁忙，请稍后重试。",
        invalidResponse: "语音播放服务返回了无效响应，请重试。",
        unavailable: "语音播放服务暂时不可用，请稍后重试。",
      },
    },
  },
};
