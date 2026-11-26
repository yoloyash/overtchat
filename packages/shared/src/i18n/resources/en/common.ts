export const common = {
  relativeTime: {
    justNow: "Just now",
    justNowInline: "just now",
    minutesAgo: "{{minutes}}m ago",
    hoursAgo: "{{hours}}h ago",
    yesterday: "Yesterday",
    yesterdayInline: "yesterday",
    daysAgo: "{{days}}d ago",
  },
  errors: {
    generic: "Something went wrong. Please try again.",
    signInRequired: "Sign in to continue.",
    permissionDenied: "You don't have permission to do this.",
    tooManyRequests: "Too many requests. Try again shortly.",
    requestFailed: "Could not complete the request. Please try again.",
    speech: {
      stt: {
        disabled: "Dictation is turned off on this server.",
        notConfigured: "Dictation hasn't been set up on this server.",
        unreachable:
          "Couldn't reach the transcription service. Try again shortly.",
        timeout: "The transcription service took too long to respond. Try again.",
        providerAuth:
          "The transcription service rejected the server's credentials. Ask an administrator to check the speech settings.",
        rateLimited: "The transcription service is busy. Try again shortly.",
        invalidResponse:
          "The transcription service returned an invalid response. Try again.",
        unavailable:
          "The transcription service is temporarily unavailable. Try again shortly.",
      },
      tts: {
        disabled: "Read aloud is turned off on this server.",
        notConfigured: "Read aloud hasn't been set up on this server.",
        unreachable:
          "Couldn't reach the speech playback service. Try again shortly.",
        timeout:
          "The speech playback service took too long to respond. Try again.",
        providerAuth:
          "The speech playback service rejected the server's credentials. Ask an administrator to check the speech settings.",
        rateLimited:
          "The speech playback service is busy. Try again shortly.",
        invalidResponse:
          "The speech playback service returned an invalid response. Try again.",
        unavailable:
          "The speech playback service is temporarily unavailable. Try again shortly.",
      },
    },
  },
} as const;
