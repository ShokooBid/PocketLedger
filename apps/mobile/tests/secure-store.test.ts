import { afterEach, describe, expect, it, jest } from "@jest/globals";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { credentialStore } from "../src/auth/secure-store";
import { stored } from "./auth-fixtures";

jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn()
}));
afterEach(() => {
  jest.restoreAllMocks();
});
describe("platform credential storage", () => {
  it("stores the complete rotation record as one device-only secure item", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    jest
      .mocked(SecureStore.getItemAsync)
      .mockResolvedValueOnce(JSON.stringify(stored()));
    await credentialStore.write(stored());
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "pocketledger.session.v1",
      JSON.stringify(stored()),
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }
    );
    expect(await credentialStore.read()).toEqual(stored());
    await credentialStore.clear();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      "pocketledger.session.v1",
      expect.any(Object)
    );
  });
  it("deletes malformed credentials while preserving data on OS storage failure", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce("malformed");
    expect(await credentialStore.read()).toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
    jest
      .mocked(SecureStore.getItemAsync)
      .mockRejectedValueOnce(new Error("device locked"));
    await expect(credentialStore.read()).rejects.toBeDefined();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
  });
  it("keeps web preview demo-only without any browser persistence", async () => {
    jest.replaceProperty(Platform, "OS", "web");
    expect(await credentialStore.read()).toBeNull();
    await expect(credentialStore.write(stored())).rejects.toMatchObject({
      kind: "configuration"
    });
    await credentialStore.clear();
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });
});
