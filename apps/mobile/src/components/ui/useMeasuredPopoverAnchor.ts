import { useCallback, useEffect, useRef, useState } from "react";
import type { View } from "react-native";
import { Rect } from "react-native-popover-view";

export function useMeasuredPopoverAnchor() {
  const anchorRef = useRef<View>(null);
  const mountedRef = useRef(false);
  const [anchorRect, setAnchorRect] = useState<Rect | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const open = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    // Popovers receive a geometry snapshot so a virtualized or replaced anchor
    // can safely unmount while the menu is open.
    anchor.measureInWindow((x, y, width, height) => {
      if (!mountedRef.current || anchorRef.current !== anchor) return;
      if (![x, y, width, height].every(Number.isFinite)) return;
      if (width <= 0 || height <= 0) return;

      setAnchorRect(new Rect(x, y, width, height));
      setVisible(true);
    });
  }, []);

  const close = useCallback(() => setVisible(false), []);

  return { anchorRef, anchorRect, visible, open, close };
}
