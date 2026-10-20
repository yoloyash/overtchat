import structuredClone from "@ungap/structured-clone";
import { Platform } from "react-native";

if (Platform.OS !== "web") {
  const installIfMissing = (name, value) => {
    if (typeof globalThis[name] === "undefined") {
      Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    }
  };

  // Install synchronously before the realtime SDK and chat streaming load.
  // CustomEvent's ponyfill extends Event, so load it after Event is available.
  const { Event, EventTarget } = require("event-target-shim");
  installIfMissing("Event", Event);
  installIfMissing("EventTarget", EventTarget);
  const { CustomEvent } = require("@whatwg-node/events");
  installIfMissing("CustomEvent", CustomEvent);

  const { TextEncoderStream, TextDecoderStream } = require("@stardazed/streams-text-encoding");
  installIfMissing("structuredClone", structuredClone);
  installIfMissing("TextEncoderStream", TextEncoderStream);
  installIfMissing("TextDecoderStream", TextDecoderStream);
}

export {};
