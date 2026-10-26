import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { storedSessionSchema, type CredentialStore } from "./contracts";
import { ClientFailure } from "./transport";

const key = "pocketledger.session.v1";
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
};
export const credentialStore: CredentialStore = {
  async read() {
    // Web is an explicit demo-only preview; no browser credential persistence.
    if (Platform.OS === "web") return null;
    const raw = await SecureStore.getItemAsync(key, options);
    if (!raw) return null;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
    const parsed = storedSessionSchema.safeParse(value);
    if (!parsed.success) {
      await SecureStore.deleteItemAsync(key, options);
      return null;
    }
    return parsed.data;
  },
  async write(value) {
    if (Platform.OS === "web") throw new ClientFailure("configuration");
    await SecureStore.setItemAsync(key, JSON.stringify(value), options);
  },
  async clear() {
    if (Platform.OS !== "web") await SecureStore.deleteItemAsync(key, options);
  }
};
