import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const iosId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const localHttp =
    process.env.EXPO_PUBLIC_ALLOW_LOCAL_HTTP === "true" &&
    process.env.EAS_BUILD_PROFILE !== "production";
  return {
    ...config,
    name: "PocketLedger",
    slug: "pocketledger",
    android: { ...config.android, package: "com.shokoobid.pocketledger" },
    ios: { ...config.ios, bundleIdentifier: "com.shokoobid.pocketledger" },
    plugins: [
      ...(config.plugins ?? []),
      "expo-secure-store",
      "expo-dev-client",
      [
        "expo-build-properties",
        {
          android: { usesCleartextTraffic: localHttp }
        }
      ],
      // Android uses an explicit web client ID. iOS also needs its reversed URL scheme.
      [
        "react-native-nitro-google-signin",
        {
          iosUrlScheme: iosId
            ? iosId.split(".").reverse().join(".")
            : "com.googleusercontent.apps.UNCONFIGURED"
        }
      ],
      "./plugins/with-google-url-handler"
    ]
  };
};
