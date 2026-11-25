import { useTranslation } from "react-i18next";
import { i18n } from "@overtchat/shared/i18n";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import {
  AppState,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  isLocalOnlyServer,
  parseMobileServerUrl,
} from "@overtchat/shared/mobile-connection";
import { useTheme } from "@/lib/theme";

export function ServerQrScanner({
  onScan,
  onClose,
}: {
  onScan: (url: string) => void;
  onClose: () => void;
}) {
  const { colors, fonts, radii } = useTheme();
  const { t } = useTranslation();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(AppState.currentState === "active");
  const consumed = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setActive(state === "active");
      if (state === "active") {
        void getPermission().catch(() =>
          setError(i18n.t("app.mobile.qrScanner.errors.checkPermission")),
        );
      }
    });
    return () => subscription.remove();
  }, [getPermission]);

  const textStyle = { color: colors.foreground, fontFamily: fonts.sansRegular };
  const buttonStyle = {
    padding: 14,
    borderRadius: radii.md,
    backgroundColor: colors.secondary,
    alignItems: "center" as const,
  };

  function scan(data: string) {
    if (consumed.current) return;
    consumed.current = true;
    const server = parseMobileServerUrl(data);
    if (!server) {
      setError(t("app.mobile.qrScanner.errors.notServerAddress"));
    } else if (isLocalOnlyServer(server)) {
      setError(t("app.mobile.qrScanner.errors.localOnly"));
    } else {
      onScan(server);
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flex: 1, padding: 24, gap: 20 }}>
          <Text
            accessibilityRole="header"
            style={[
              textStyle,
              { fontFamily: fonts.serifSemiBold, fontSize: 24 },
            ]}
          >
            {t("app.mobile.qrScanner.title")}
          </Text>
          <Text style={[textStyle, { color: colors.mutedForeground }]}>
            {t("app.mobile.qrScanner.instructions")}
          </Text>
          <View
            style={{
              flex: 1,
              minHeight: 180,
              borderRadius: radii.xl,
              overflow: "hidden",
              backgroundColor: colors.muted,
              justifyContent: "center",
            }}
          >
            {permission?.granted && active && !error ? (
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={({ data }) => scan(data)}
                onMountError={() =>
                  setError(t("app.mobile.qrScanner.errors.cameraMount"))
                }
              />
            ) : (
              <View style={{ padding: 24, gap: 20 }}>
                <Text accessibilityLiveRegion="polite" style={textStyle}>
                  {error ??
                    (permission
                      ? t("app.mobile.qrScanner.permissionPrompt")
                      : t("app.mobile.qrScanner.checkingPermission"))}
                </Text>
                {error ? (
                  <Pressable
                    accessibilityRole="button"
                    style={buttonStyle}
                    onPress={() => {
                      consumed.current = false;
                      setError(null);
                    }}
                  >
                    <Text style={textStyle}>{t("app.error.tryAgain")}</Text>
                  </Pressable>
                ) : permission && !permission.granted ? (
                  <Pressable
                    accessibilityRole="button"
                    style={buttonStyle}
                    onPress={() => {
                      void (
                        permission.canAskAgain
                          ? requestPermission()
                          : Linking.openSettings()
                      ).catch(() =>
                        setError(
                          t("app.mobile.qrScanner.errors.openPermissions"),
                        ),
                      );
                    }}
                  >
                    <Text style={textStyle}>
                      {permission.canAskAgain
                        ? t("app.mobile.qrScanner.allowCamera")
                        : t("app.mobile.qrScanner.openSettings")}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>
          <Text
            style={[textStyle, { color: colors.mutedForeground, fontSize: 13 }]}
          >
            {t("app.mobile.qrScanner.footer")}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={buttonStyle}
            onPress={onClose}
          >
            <Text style={textStyle}>{t("common.mobile.actions.cancel")}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
