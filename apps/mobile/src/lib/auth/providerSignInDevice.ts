import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { NATIVE_SIGN_IN_EXCHANGE_PATH } from "@overtchat/shared";
import { getAuthClient } from "./client";
import type { ProviderSignInDevice } from "./providerSignIn";

/** The phone's part in signing in with the identity provider. */
export const providerSignInDevice: ProviderSignInDevice = {
  randomBytes: (count) => Crypto.getRandomBytes(count),
  async sha256(text) {
    // The secret is base64url, so each character is one byte.
    const bytes = Uint8Array.from(text, (character) => character.charCodeAt(0));
    return new Uint8Array(
      await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes),
    );
  },
  async openBrowser(url, redirectUri) {
    const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);
    return result.type === "success" ? result.url : null;
  },
  async exchange(grant) {
    // The Expo plugin keeps the session cookie this response sets.
    const { error } = await getAuthClient().$fetch(NATIVE_SIGN_IN_EXCHANGE_PATH, {
      method: "POST",
      body: grant,
    });
    return !error;
  },
};
