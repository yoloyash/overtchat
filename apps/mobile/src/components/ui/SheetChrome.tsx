import {
  BottomSheetBackdrop,
  BottomSheetHandle,
  type BottomSheetHandleProps,
} from "@gorhom/bottom-sheet";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";

/** The sheet library's backdrop, with its screen-reader text in the active language. */
export function SheetBackdrop(props: ComponentProps<typeof BottomSheetBackdrop>) {
  const { t } = useTranslation();
  return (
    <BottomSheetBackdrop
      accessibilityLabel={t("common.mobile.sheet.backdropLabel")}
      accessibilityHint={t("common.mobile.sheet.backdropHint")}
      {...props}
    />
  );
}

/** The sheet library's drag handle, with its screen-reader text in the active language. */
export function SheetHandle(props: BottomSheetHandleProps) {
  const { t } = useTranslation();
  return (
    <BottomSheetHandle
      accessibilityLabel={t("common.mobile.sheet.handleLabel")}
      accessibilityHint={t("common.mobile.sheet.handleHint")}
      {...props}
    />
  );
}
