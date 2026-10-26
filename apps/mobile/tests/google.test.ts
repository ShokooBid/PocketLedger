import { afterEach, describe, expect, it, jest } from "@jest/globals";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";
import { GoogleOneTapSignIn as google } from "react-native-nitro-google-signin";
import { googleProof } from "../src/auth/google.native";

jest.mock("react-native-nitro-google-signin", () => ({
  GoogleOneTapSignIn: {
    configure: jest.fn(),
    checkPlayServices: jest.fn(),
    presentExplicitSignIn: jest.fn(),
    signOut: jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
  }
}));
const previous = {
  web: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
};
afterEach(() => {
  jest.restoreAllMocks();
  for (const [key, value] of Object.entries({
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: previous.web,
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: previous.ios
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
function native() {
  jest.replaceProperty(
    Constants,
    "executionEnvironment",
    ExecutionEnvironment.Bare
  );
  jest.replaceProperty(Platform, "OS", "android");
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID =
    "synthetic.apps.googleusercontent.com";
}
describe("native Google proof boundary", () => {
  it("passes the exact challenge nonce through explicit native UI and discards provider state", async () => {
    native();
    jest.mocked(google.presentExplicitSignIn).mockResolvedValueOnce({
      type: "success",
      data: { idToken: "synthetic-proof" }
    } as Awaited<ReturnType<typeof google.presentExplicitSignIn>>);
    expect(await googleProof("n".repeat(43))).toBe("synthetic-proof");
    expect(google.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        nonce: "n".repeat(43),
        offlineAccess: false,
        scopes: []
      })
    );
    expect(google.signOut).toHaveBeenCalledTimes(1);
  });
  it("handles cancellation and sanitizes native failures", async () => {
    native();
    jest
      .mocked(google.presentExplicitSignIn)
      .mockResolvedValueOnce({ type: "cancelled", data: null });
    expect(await googleProof("n".repeat(43))).toBeNull();
    jest
      .mocked(google.presentExplicitSignIn)
      .mockRejectedValueOnce(new Error("private provider token"));
    await expect(googleProof("n".repeat(43))).rejects.toMatchObject({
      message: "provider"
    });
  });
  it("fails safely in Expo Go and on unconfigured iOS builds", async () => {
    native();
    jest.replaceProperty(
      Constants,
      "executionEnvironment",
      ExecutionEnvironment.StoreClient
    );
    await expect(googleProof("n".repeat(43))).rejects.toMatchObject({
      kind: "configuration"
    });
    jest.replaceProperty(
      Constants,
      "executionEnvironment",
      ExecutionEnvironment.Bare
    );
    jest.replaceProperty(Platform, "OS", "ios");
    delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
    await expect(googleProof("n".repeat(43))).rejects.toMatchObject({
      kind: "configuration"
    });
    expect(google.presentExplicitSignIn).not.toHaveBeenCalled();
  });
});
