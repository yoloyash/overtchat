export const auth = {
  fields: {
    name: "Name",
    email: "Email",
    password: "Password",
  },
  actions: {
    cancel: "Cancel",
    signOut: "Sign out",
  },
  desktopServer: {
    connectedTo: "Connected to <host>{{host}}</host>",
    changeServer: "Change server",
  },
  login: {
    title: "Welcome back",
    subtitle: "Sign in to continue.",
    submit: "Sign in",
    submitting: "Signing in…",
    failed: "Login failed",
    or: "or",
    ssoContinue: "Continue with {{provider}}",
    ssoWaiting: "Waiting for {{provider}}…",
    ssoInBrowser:
      "Finish signing in in your browser. To start again, choose Continue with {{provider}}.",
    forgotPassword: "Forgot password?",
    recoveryAdmin:
      "Contact your server administrator to reset your password. Another administrator can also help if you are an admin.",
    recoveryCli:
      "If all administrators are locked out, the server owner can run <resetPassword>{{resetPassword}}</resetPassword> on the server, or <resetTwoFactor>{{resetTwoFactor}}</resetTwoFactor> for a lost authenticator.",
  },
  signup: {
    title: "Create the first account",
    subtitle: "This becomes the admin account. Signup closes after this.",
    setupCode: "Setup code",
    setupCodeHint:
      "Use the code from your installer, run overtchat status on the server, or check the app container's logs.",
    passwordHint: "At least 8 characters.",
    submit: "Create account",
    submitting: "Creating…",
    failed: "Signup failed",
  },
  sso: {
    errors: {
      signupDisabled:
        "Your {{provider}} account doesn't have an OvertChat account on this server. Ask your administrator to add you.",
      accountNotLinked:
        "Your {{provider}} account couldn't be matched to your OvertChat account. Ask your administrator for help.",
      emailMissing:
        "{{provider}} didn't share your email address, so OvertChat can't tell who you are. Ask your administrator to check its setup.",
      banned:
        "Your account on this server is disabled. Ask your administrator for help.",
      cancelled: "Sign-in was cancelled.",
      expired: "That sign-in took too long. Try again.",
      generic:
        "Couldn't sign in with {{provider}}. Try again, and ask your administrator if it keeps happening.",
    },
  },
  signInRequest: {
    title: "Is this you signing in?",
    instruction: "Pick the number shown on the sign-in screen.",
    choicesLabel: "Number choices",
    deny: "No, it's not me",
    toast: {
      approvedTitle: "Sign-in approved",
      mismatchTitle: "Sign-in blocked",
      mismatchDescription:
        "That number didn't match. If you were signing in, try again; if not, change your password.",
      deniedTitle: "Sign-in denied",
      deniedDescription: "If this wasn't you, change your password.",
      expiredTitle: "This request expired",
      errorTitle: "Couldn't answer the sign-in request",
      errorDescription: "Check your connection and try again.",
    },
  },
  twoFactor: {
    methods: {
      useAuthenticator: "Use your authenticator app",
      useBackupCode: "Use a backup code",
      approveOnAnotherDevice: "Approve on another device",
    },
    code: {
      title: "Two-factor authentication",
      totpDescription: "Enter the 6-digit code from your authenticator app.",
      backupDescription:
        "Enter one of the backup codes you saved when you set up two-factor.",
      totpLabel: "Authentication code",
      backupLabel: "Backup code",
      verify: "Verify",
      verifying: "Verifying…",
      lostHelp:
        "Lost your authenticator and backup codes? Ask a server administrator to reset two-factor for you.",
    },
    approval: {
      title: "Approve this sign-in",
      description:
        "Open OvertChat on a phone or computer where you're signed in, and pick this number.",
      sendNewRequest: "Send a new request",
      sendingLabel: "Sending request",
      numberLabel: "Number {{number}}",
      sending: "Sending request…",
      verifying: "Approved. Signing in…",
      waiting: "Waiting for approval…",
      networkError:
        "Couldn't reach the server. Check your connection and try again.",
      ended: {
        denied: "The sign-in was denied on your other device.",
        mismatch: "The wrong number was picked, so the sign-in was blocked.",
        expired: "The request expired. Send a new one or use another method.",
      },
    },
    errors: {
      noApprovers:
        "You're not signed in on any other device. Use your authenticator app instead.",
      tooManyRequests:
        "Too many sign-in requests. Wait a few minutes or use your authenticator app.",
      invalidCode:
        "That code didn't work. Check your authenticator and try again.",
      invalidBackupCode:
        "That backup code didn't work or was already used.",
      expired: "This sign-in expired. Enter your password again.",
      tooManyAttempts: "Too many wrong codes. Enter your password again.",
      temporarilyLocked:
        "Too many wrong codes. Wait 15 minutes, then try again.",
      fallback: "Could not verify the code. Try again.",
    },
    required: {
      title: "Set up two-factor authentication",
      description:
        "This server requires administrators to sign in with a code from an authenticator app, as well as their password.",
    },
    prompt: {
      title: "Protect your account",
      description:
        "Turn on two-factor authentication so a stolen password isn't enough to get in. Sign-in will also ask for a code from an authenticator app on your phone. It takes about a minute.",
      notNow: "Not now",
      setup: "Set up two-factor",
      settingsHint: "You can always find this in Settings → Security.",
    },
    setup: {
      confirmPassword: "Confirm your password",
      checking: "Checking…",
      continue: "Continue",
      startFailed: "Could not start two-factor setup.",
      scanStep:
        "<lead>1. Scan this code</lead> with an authenticator app such as 1Password, Google Authenticator, or Authy.",
      qrLabel: "Authenticator setup code",
      manualKey: "Can't scan it? Enter this key instead: <key>{{key}}</key>",
      verifyStep: "2. Enter the 6-digit code it shows",
      verifying: "Verifying…",
      turnOn: "Turn on two-factor",
      backupCodesIntro:
        "Two-factor is on. Save these backup codes somewhere safe. Each one signs you in once if you lose your authenticator.",
    },
    backupCodes: {
      listLabel: "Backup codes",
      copy: "Copy",
      copied: "Copied",
      download: "Download",
      saved: "I saved them",
    },
  },
  mobile: {
    unexpectedSessionResponse:
      "The server didn't answer like OvertChat. A proxy or Wi-Fi sign-in page may be in the way.",
    login: {
      approvalDescription:
        "Open OvertChat on a computer or another device where you're signed in, and pick this number.",
      verifyFailed: "Could not verify the code.",
      recoveryAlertMessage:
        "Contact your server administrator to reset your password. Another administrator can also help if you are an admin.\n\nIf all administrators are locked out, the server owner can run overtchat reset-password on the server, or overtchat reset-two-factor for a lost authenticator.",
      changeServerShort: "Change",
    },
    requiredTwoFactor: {
      description:
        "This server requires administrators to sign in with a code from an authenticator app, as well as their password. Set it up on the web, then come back.",
      setupOnWeb: "Set up on the web",
      doneSetup: "I've set it up",
      signingOut: "Signing out…",
    },
    signInRequest: {
      screenTitle: "Sign-in request",
      expiredBody:
        "This sign-in request is no longer waiting. It was answered or expired.",
      footnote:
        "If you didn't just try to sign in, someone may know your password.",
      loadError: "Could not load sign-in requests.",
      answerError: "Couldn't answer the sign-in request. Try again.",
    },
  },
} as const;
