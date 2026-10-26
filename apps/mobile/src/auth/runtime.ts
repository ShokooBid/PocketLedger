import { Platform } from "react-native";
import { credentialStore } from "./secure-store";
import { googleProof } from "./google";
import { createSessionController } from "./session-controller";
import { createTransport } from "./transport";

export function createRuntimeSession() {
  return createSessionController(
    credentialStore,
    createTransport(
      Platform.OS === "web" ? undefined : process.env.EXPO_PUBLIC_API_URL,
      fetch,
      __DEV__ && process.env.EXPO_PUBLIC_ALLOW_LOCAL_HTTP === "true"
    ),
    googleProof
  );
}
