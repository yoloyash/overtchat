export const CHAT_BOTTOM_THRESHOLD = 80;

export type ChatScrollFollowMode = "following" | "detached";

export type ChatScrollFollowState = {
  mode: ChatScrollFollowMode;
  userScrollActive: boolean;
};

export type ChatScrollFollowEvent =
  | { type: "user-scroll-begin" }
  | { type: "user-scroll-position"; nearBottom: boolean }
  | { type: "user-scroll-end"; nearBottom: boolean }
  | { type: "follow-requested" };

export const initialChatScrollFollowState: ChatScrollFollowState = {
  mode: "following",
  userScrollActive: false,
};

export function isChatScrollNearBottom({
  contentHeight,
  viewportHeight,
  offsetY,
  threshold = CHAT_BOTTOM_THRESHOLD,
}: {
  contentHeight: number;
  viewportHeight: number;
  offsetY: number;
  threshold?: number;
}) {
  return contentHeight - viewportHeight - offsetY <= threshold;
}

export function reduceChatScrollFollow(
  state: ChatScrollFollowState,
  event: ChatScrollFollowEvent,
): ChatScrollFollowState {
  if (event.type === "follow-requested") {
    return initialChatScrollFollowState;
  }

  if (event.type === "user-scroll-begin") {
    return { ...state, userScrollActive: true };
  }

  if (event.type === "user-scroll-position") {
    if (!state.userScrollActive) return state;
    return {
      ...state,
      mode: event.nearBottom ? "following" : "detached",
    };
  }

  return {
    mode: event.nearBottom ? "following" : "detached",
    userScrollActive: false,
  };
}

export function shouldPinChatToBottom(state: ChatScrollFollowState) {
  return state.mode === "following" && !state.userScrollActive;
}
