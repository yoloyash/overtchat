import type { Translation } from "../../catalog";

export const auth: Translation["auth"] = {
  fields: {
    name: "姓名",
    email: "邮箱",
    password: "密码",
  },
  actions: {
    cancel: "取消",
    signOut: "退出登录",
  },
  desktopServer: {
    connectedTo: "已连接到 <host>{{host}}</host>",
    changeServer: "切换服务器",
  },
  login: {
    title: "欢迎回来",
    subtitle: "请登录以继续。",
    submit: "登录",
    submitting: "正在登录…",
    failed: "登录失败",
    or: "或",
    ssoContinue: "使用 {{provider}} 继续",
    ssoWaiting: "正在等待 {{provider}}…",
    ssoInBrowser:
      "请在浏览器中完成登录。如需重新开始，请选择“使用 {{provider}} 继续”。",
    forgotPassword: "忘记密码？",
    recoveryAdmin:
      "请联系你的服务器管理员重置密码。如果你是管理员，也可以请其他管理员协助处理。",
    recoveryCli:
      "如果所有管理员都无法登录，服务器所有者可以在服务器上运行 <resetPassword>{{resetPassword}}</resetPassword>，或在丢失身份验证器时运行 <resetTwoFactor>{{resetTwoFactor}}</resetTwoFactor>。",
  },
  signup: {
    title: "创建首个账号",
    subtitle: "此账号将成为管理员账号，创建后将关闭注册。",
    setupCode: "安装码",
    setupCodeHint:
      "使用安装程序提供的安装码，在服务器上运行 overtchat status，或查看应用容器日志。",
    passwordHint: "至少 8 个字符。",
    submit: "创建账号",
    submitting: "正在创建…",
    failed: "注册失败",
  },
  sso: {
    errors: {
      signupDisabled:
        "你的 {{provider}} 账号在此服务器上没有对应的 OvertChat 账号。请联系管理员为你添加。",
      accountNotLinked:
        "你的 {{provider}} 账号无法关联到你的 OvertChat 账号。请联系管理员获取帮助。",
      emailMissing:
        "{{provider}} 未提供你的邮箱地址，OvertChat 无法识别你的身份。请联系管理员检查配置。",
      banned: "你在此服务器上的账号已被禁用。请联系管理员获取帮助。",
      cancelled: "登录已取消。",
      expired: "登录超时，请重试。",
      generic:
        "无法使用 {{provider}} 登录。请重试，如果问题持续存在，请联系管理员。",
    },
  },
  signInRequest: {
    title: "是你正在登录吗？",
    instruction: "请选择登录界面上显示的数字。",
    choicesLabel: "可选数字",
    deny: "不是我",
    toast: {
      approvedTitle: "已批准登录",
      mismatchTitle: "已阻止登录",
      mismatchDescription:
        "数字不匹配。如果这是你本人登录，请重试；如果不是，请立即修改密码。",
      deniedTitle: "已拒绝登录",
      deniedDescription: "如果这不是你本人操作，请立即修改密码。",
      expiredTitle: "此请求已过期",
      errorTitle: "无法回应登录请求",
      errorDescription: "请检查网络连接后重试。",
    },
  },
  twoFactor: {
    methods: {
      useAuthenticator: "使用身份验证器应用",
      useBackupCode: "使用备用恢复码",
      approveOnAnotherDevice: "在另一台设备上批准",
    },
    code: {
      title: "双因素认证",
      totpDescription: "输入身份验证器应用中的 6 位验证码。",
      backupDescription: "输入你设置双因素认证时保存的任一备用恢复码。",
      totpLabel: "验证码",
      backupLabel: "备用恢复码",
      verify: "验证",
      verifying: "正在验证…",
      lostHelp:
        "丢失了身份验证器和备用恢复码？请联系服务器管理员为你重置双因素认证。",
    },
    approval: {
      title: "批准此次登录",
      description:
        "在已登录 OvertChat 的手机或电脑上打开应用，并选择此数字。",
      sendNewRequest: "发送新请求",
      sendingLabel: "正在发送请求",
      numberLabel: "数字 {{number}}",
      sending: "正在发送请求…",
      verifying: "已批准，正在登录…",
      waiting: "正在等待批准…",
      networkError: "无法连接到服务器。请检查网络连接后重试。",
      ended: {
        denied: "另一台设备已拒绝此次登录。",
        mismatch: "选择了错误的数字，此次登录已被阻止。",
        expired: "请求已过期。请发送新请求或使用其他方式。",
      },
    },
    errors: {
      noApprovers: "你未在任何其他设备上登录。请改用身份验证器应用。",
      tooManyRequests: "登录请求过于频繁。请等待几分钟或改用身份验证器应用。",
      invalidCode: "验证码无效。请检查身份验证器应用后重试。",
      invalidBackupCode: "备用恢复码无效或已被使用。",
      expired: "此次登录已过期。请重新输入密码。",
      tooManyAttempts: "错误次数过多。请重新输入密码。",
      temporarilyLocked: "错误次数过多。请等待 15 分钟后重试。",
      fallback: "无法验证该验证码。请重试。",
    },
    required: {
      title: "设置双因素认证",
      description:
        "此服务器要求管理员登录时除密码外，还需输入身份验证器应用的验证码。",
    },
    prompt: {
      title: "保护你的账号",
      description:
        "开启双因素认证，防止密码泄露后他人直接登录。登录时还将要求输入手机身份验证器应用中的验证码。整个过程大约需要一分钟。",
      notNow: "暂不设置",
      setup: "设置双因素认证",
      settingsHint: "你随时可以在“设置 → 安全”中找到此选项。",
    },
    setup: {
      confirmPassword: "确认你的密码",
      checking: "正在检查…",
      continue: "继续",
      startFailed: "无法开始双因素认证设置。",
      scanStep:
        "<lead>1. 扫描此二维码</lead>，使用 1Password、Google Authenticator 或 Authy 等身份验证器应用。",
      qrLabel: "身份验证器设置二维码",
      manualKey: "无法扫描？请改用此密钥：<key>{{key}}</key>",
      verifyStep: "2. 输入应用显示的 6 位验证码",
      verifying: "正在验证…",
      turnOn: "开启双因素认证",
      backupCodesIntro:
        "双因素认证已开启。请将这些备用恢复码保存在安全的地方。如果你丢失了身份验证器，每个恢复码都可以用于登录一次。",
    },
    backupCodes: {
      listLabel: "备用恢复码",
      copy: "复制",
      copied: "已复制",
      download: "下载",
      saved: "我已保存",
    },
  },
};
