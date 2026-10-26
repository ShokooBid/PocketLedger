/* global require */
/* eslint-disable @typescript-eslint/no-require-imports -- Metro loads Nitro only after configuration. */
import Constants from "expo-constants";
import type * as GoogleModule from "react-native-nitro-google-signin";
import { Platform } from "react-native";
import { ClientFailure } from "./transport";

export async function googleProof(nonce: string): Promise<string | null> {
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (
    Constants.executionEnvironment === "storeClient" ||
    !webClientId ||
    (Platform.OS === "ios" && !iosClientId)
  )
    throw new ClientFailure("configuration");
  try {
    // Metro's lazy require keeps Expo Go previews from evaluating Nitro bindings.
    const {
      GoogleOneTapSignIn: google
    }: typeof GoogleModule = require("react-native-nitro-google-signin");
    // Both native implementations pass this nonce through unchanged. It must
    // exactly match the backend challenge; do not hash or generate another one.
    google.configure({
      webClientId,
      ...(iosClientId ? { iosClientId } : {}),
      nonce,
      offlineAccess: false,
      scopes: [],
      autoSelectOnSignIn: false
    });
    await google.checkPlayServices();
    try {
      const result = await google.presentExplicitSignIn();
      if (result.type === "cancelled") return null;
      if (result.type !== "success" || !result.data?.idToken)
        throw new ClientFailure("provider");
      return result.data.idToken;
    } finally {
      // PocketLedger owns persistence; discard the temporary provider session.
      await google.signOut().catch(() => {});
    }
  } catch (error) {
    if (error instanceof ClientFailure) throw error;
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "SIGN_IN_CANCELLED"
    )
      return null;
    throw new ClientFailure("provider");
  }
}
