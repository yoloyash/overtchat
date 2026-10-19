import structuredClone from "@ungap/structured-clone";
import { Platform } from "react-native";

if (Platform.OS !== "web") {
  // The realtime SDK's browser emitter needs DOM events. React Native ships
  // these implementations for its own APIs but does not expose them globally.
  const { polyfillGlobal } = require("react-native/Libraries/Utilities/PolyfillFunctions");
  if (!("EventTarget" in global)) {
    polyfillGlobal("EventTarget", () => require("react-native/src/private/webapis/dom/events/EventTarget").default);
  }
  if (!("CustomEvent" in global)) {
    polyfillGlobal("CustomEvent", () => require("react-native/src/private/webapis/dom/events/CustomEvent").default);
  }
  const setupPolyfills = async () => {
    const { polyfillGlobal } = await import(
      "react-native/Libraries/Utilities/PolyfillFunctions"
    );
    const { TextEncoderStream, TextDecoderStream } = await import(
      "@stardazed/streams-text-encoding"
    );
    if (!("structuredClone" in global)) {
      polyfillGlobal("structuredClone", () => structuredClone);
    }
    polyfillGlobal("TextEncoderStream", () => TextEncoderStream);
    polyfillGlobal("TextDecoderStream", () => TextDecoderStream);
  };
  setupPolyfills();
}

export {};
