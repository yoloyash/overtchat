import type { UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
} from "react-native";
import {
  type ChatScrollFollowEvent,
  initialChatScrollFollowState,
  isChatScrollNearBottom,
  reduceChatScrollFollow,
  shouldPinChatToBottom,
} from "./scroll-follow";

export function useScrollFollow({
  latestMessageId,
  latestMessageRole,
}: {
  latestMessageId: string | undefined;
  latestMessageRole: UIMessage["role"] | undefined;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const followStateRef = useRef(initialChatScrollFollowState);
  const latestMessageIdRef = useRef(latestMessageId);
  const scrollFrameRef = useRef<number | null>(null);
  const pendingScrollAnimatedRef = useRef(false);
  const userScrollEndFrameRef = useRef<number | null>(null);
  const [isFollowing, setIsFollowing] = useState(true);

  const applyFollowEvent = useCallback((event: ChatScrollFollowEvent) => {
    const next = reduceChatScrollFollow(followStateRef.current, event);
    followStateRef.current = next;
    const following = next.mode === "following";
    setIsFollowing((current) =>
      current === following ? current : following,
    );
    return next;
  }, []);

  const clearScheduledScroll = useCallback(() => {
    if (scrollFrameRef.current === null) return;
    cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = null;
    pendingScrollAnimatedRef.current = false;
  }, []);

  const scheduleScrollToEnd = useCallback((animated: boolean) => {
    pendingScrollAnimatedRef.current ||= animated;
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const shouldAnimate = pendingScrollAnimatedRef.current;
      pendingScrollAnimatedRef.current = false;
      scrollRef.current?.scrollToEnd({ animated: shouldAnimate });
    });
  }, []);

  const clearPendingUserScrollEnd = useCallback(() => {
    if (userScrollEndFrameRef.current === null) return;
    cancelAnimationFrame(userScrollEndFrameRef.current);
    userScrollEndFrameRef.current = null;
  }, []);

  const nearBottomFromEvent = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      return isChatScrollNearBottom({
        contentHeight: contentSize.height,
        viewportHeight: layoutMeasurement.height,
        offsetY: contentOffset.y,
      });
    },
    [],
  );

  const finishUserScroll = useCallback(
    (nearBottom: boolean) => {
      const next = applyFollowEvent({
        type: "user-scroll-end",
        nearBottom,
      });
      if (shouldPinChatToBottom(next)) {
        scheduleScrollToEnd(false);
      }
    },
    [applyFollowEvent, scheduleScrollToEnd],
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      applyFollowEvent({
        type: "user-scroll-position",
        nearBottom: nearBottomFromEvent(event),
      });
    },
    [applyFollowEvent, nearBottomFromEvent],
  );

  const handleScrollBeginDrag = useCallback(() => {
    clearPendingUserScrollEnd();
    clearScheduledScroll();
    applyFollowEvent({ type: "user-scroll-begin" });
  }, [applyFollowEvent, clearPendingUserScrollEnd, clearScheduledScroll]);

  const handleScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nearBottom = nearBottomFromEvent(event);
      clearPendingUserScrollEnd();
      userScrollEndFrameRef.current = requestAnimationFrame(() => {
        userScrollEndFrameRef.current = null;
        finishUserScroll(nearBottom);
      });
    },
    [clearPendingUserScrollEnd, finishUserScroll, nearBottomFromEvent],
  );

  const handleMomentumScrollBegin = useCallback(() => {
    clearPendingUserScrollEnd();
  }, [clearPendingUserScrollEnd]);

  const handleMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      clearPendingUserScrollEnd();
      finishUserScroll(nearBottomFromEvent(event));
    },
    [clearPendingUserScrollEnd, finishUserScroll, nearBottomFromEvent],
  );

  const handleContentSizeChange = useCallback(() => {
    if (shouldPinChatToBottom(followStateRef.current)) {
      scheduleScrollToEnd(false);
    }
  }, [scheduleScrollToEnd]);

  const handleLayout = useCallback(
    (_event: LayoutChangeEvent) => {
      if (shouldPinChatToBottom(followStateRef.current)) {
        scheduleScrollToEnd(false);
      }
    },
    [scheduleScrollToEnd],
  );

  const scrollToLatest = useCallback(() => {
    clearPendingUserScrollEnd();
    applyFollowEvent({ type: "follow-requested" });
    scheduleScrollToEnd(true);
  }, [applyFollowEvent, clearPendingUserScrollEnd, scheduleScrollToEnd]);

  useEffect(() => {
    const previousLatestMessageId = latestMessageIdRef.current;
    latestMessageIdRef.current = latestMessageId;
    if (
      latestMessageRole !== "user" ||
      latestMessageId === previousLatestMessageId
    ) {
      return;
    }
    applyFollowEvent({ type: "follow-requested" });
    scheduleScrollToEnd(false);
  }, [
    applyFollowEvent,
    latestMessageId,
    latestMessageRole,
    scheduleScrollToEnd,
  ]);

  useEffect(
    () => () => {
      clearScheduledScroll();
      clearPendingUserScrollEnd();
    },
    [clearPendingUserScrollEnd, clearScheduledScroll],
  );

  return {
    scrollRef,
    isFollowing,
    scrollToLatest,
    handleLayout,
    handleScroll,
    handleScrollBeginDrag,
    handleScrollEndDrag,
    handleMomentumScrollBegin,
    handleMomentumScrollEnd,
    handleContentSizeChange,
  };
}
