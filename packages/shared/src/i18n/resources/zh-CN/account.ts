import type { Translation } from "../../catalog";

export const account: Translation["account"] = {
  title: "安全",
  signedInAs: "当前登录账号：<email>{{email}}</email>。",
  sso: {
    title: "登录",
    descriptionWithProvider: "你通过 {{provider}} 登录。你的密码和登录保护均在那里管理。",
    descriptionDefault: "你通过身份提供方登录。你的密码和登录保护均在那里管理。",
  },
  password: {
    title: "密码",
    description: "更改密码会退出其他所有会话的登录状态。",
    currentLabel: "当前密码",
    newLabel: "新密码",
    newDescription: "至少使用 8 个字符。",
    updated: "密码已更新",
    submit: "更改密码",
    changeFailed: "更改密码失败",
  },
  twoFactor: {
    title: "两步验证",
    descriptionRequired: "此服务器上的管理员必须启用两步验证。",
    descriptionRecommended: "建议开启。登录时除密码外，还需输入身份验证器应用生成的验证码。",
    statusTitle: "状态",
    loadError: "无法加载两步验证状态。",
    backupCodesIntro: "旧的备用恢复码已失效。请将这些备用恢复码妥善保存在安全的地方。",
    authenticatorTitle: "身份验证器应用",
    enabledDescription: "已开启。在新设备登录时，你也可以从已登录的设备批准登录。请妥善保存备用恢复码，以防设备丢失。",
    newBackupCodes: "重新生成备用恢复码",
    turnOff: "关闭",
    enabledToast: "已开启两步验证",
    off: "已关闭",
    setUp: "配置",
    disabledToast: "已关闭两步验证",
    confirm: {
      passwordLabel: "你的密码",
      backupCodes: {
        title: "重新生成备用恢复码",
        description: "当前的备用恢复码将会失效。",
        submit: "生成新备用恢复码",
        pending: "正在生成…",
        error: "无法生成备用恢复码。",
      },
      disable: {
        title: "关闭两步验证",
        description: "登录时将只需输入密码。你的身份验证器条目和备用恢复码都将失效。",
        submit: "关闭",
        pending: "正在关闭…",
        error: "无法关闭两步验证。",
      },
    },
  },
  mobile: {
    sso: {
      defaultProvider: "你的身份提供方",
      description: "你的密码和登录保护均在那里管理。",
      signedInWith: "登录方式",
    },
    password: {
      newHint: "请使用 8–128 个字符。",
      confirmLabel: "确认新密码",
      errors: {
        currentRequired: "请输入当前密码。",
        invalidLength: "新密码请使用 8–128 个字符。",
        mismatch: "两次输入的新密码不一致。",
        changeFailed: "无法更改密码。",
      },
    },
    twoFactor: {
      on: "已开启",
      manageTitle: "管理两步验证",
      manageDetail: "在浏览器中配置或关闭身份验证器应用。",
    },
    emailLabel: "邮箱",
  },
};
