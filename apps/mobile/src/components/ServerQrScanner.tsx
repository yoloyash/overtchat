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
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(AppState.currentState === "active");
  const consumed = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setActive(state === "active");
      if (state === "active") {
        void getPermission().catch(() =>
          setError(
            "Could not check camera permission. Try again or enter the server address manually.",
          ),
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
      setError(
        "That code isn’t a server address. Open Connect your phone in the web app’s mobile dialog and scan that code.",
      );
    } else if (isLocalOnlyServer(server)) {
      setError(
        "This address only works on the server. Run overtchat setup and choose “On my home network”, then open the network address to scan again.",
      );
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
            Scan server QR code
          </Text>
          <Text style={[textStyle, { color: colors.mutedForeground }]}>
            On the web, open your account menu → Get the mobile app → Connect
            your phone.
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
                  setError(
                    "Could not start the camera. Try again or enter the server address manually.",
                  )
                }
              />
            ) : (
              <View style={{ padding: 24, gap: 20 }}>
                <Text accessibilityLiveRegion="polite" style={textStyle}>
                  {error ??
                    (permission
                      ? "Allow camera access to scan your server’s QR code. You can also go back and enter the address manually."
                      : "Checking camera permission…")}
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
                    <Text style={textStyle}>Try again</Text>
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
                          "Could not open camera permissions. Enable camera access in your device settings or enter the address manually.",
                        ),
                      );
                    }}
                  >
                    <Text style={textStyle}>
                      {permission.canAskAgain
                        ? "Allow camera"
                        : "Open settings"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>
          <Text
            style={[textStyle, { color: colors.mutedForeground, fontSize: 13 }]}
          >
            Scan to connect and sign in.
          </Text>
          <Pressable
            accessibilityRole="button"
            style={buttonStyle}
            onPress={onClose}
          >
            <Text style={textStyle}>Cancel</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
