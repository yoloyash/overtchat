import { Image } from "expo-image";
import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import type { AgentProviderId } from "@overtchat/agent-bridge";

// The same provider artwork used by the web client, rendered with native image/SVG primitives.
const vectors = {
  pi: '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800">\n  <rect width="800" height="800" rx="120" fill="#09090b"/>\n  <path fill="#fff" fill-rule="evenodd" d="\n    M165.29 165.29\n    H517.36\n    V400\n    H400\n    V517.36\n    H282.65\n    V634.72\n    H165.29\n    Z\n    M282.65 282.65\n    V400\n    H400\n    V282.65\n    Z\n  "/>\n  <path fill="#fff" d="M517.36 400 H634.72 V634.72 H517.36 Z"/>\n</svg>\n',
  omp: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90" width="120" height="90">\n  <!-- Official Oh My Pi icon: https://github.com/can1357/oh-my-pi/blob/main/assets/icon.svg -->\n  <rect x="10" y="8" width="100" height="12" rx="2" fill="#fafafa"/>\n  <rect x="25" y="20" width="12" height="62" rx="2" fill="#fafafa"/>\n  <rect x="75" y="20" width="12" height="45" rx="2" fill="#fafafa"/>\n  <rect x="71" y="55" width="20" height="16" rx="3" fill="#f97316"/>\n  <rect x="76" y="59" width="3" height="8" rx="1" fill="#0d0d0d"/>\n  <rect x="82" y="59" width="3" height="8" rx="1" fill="#0d0d0d"/>\n  <circle cx="18" cy="14" r="2" fill="#f97316" opacity="0.8"/>\n  <circle cx="102" cy="14" r="2" fill="#f97316" opacity="0.8"/>\n</svg>\n',
  opencode:
    '<svg width="300" height="300" viewBox="0 0 300 300" fill="none" xmlns="http://www.w3.org/2000/svg">\n  <path d="M210 240H90V120H210V240Z" fill="#4B4646"/>\n  <path d="M210 60H90V240H210V60ZM270 300H30V0H270V300Z" fill="#F1ECEC"/>\n</svg>\n',
} as const;
const images = {
  codex: require("@/assets/agent-providers/codex.png"),
  claude: require("@/assets/agent-providers/claude-code.png"),
};
export function AgentProviderIcon({
  provider,
  size = 20,
}: {
  provider: AgentProviderId;
  size?: number;
}) {
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.2,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: provider === "claude" ? "transparent" : "#09090b",
      }}
    >
      {provider === "codex" || provider === "claude" ? (
        <Image
          source={images[provider]}
          style={{ width: size, height: size }}
          contentFit="contain"
        />
      ) : (
        <SvgXml
          xml={vectors[provider]}
          width={size * 0.85}
          height={size * 0.85}
        />
      )}
    </View>
  );
}
