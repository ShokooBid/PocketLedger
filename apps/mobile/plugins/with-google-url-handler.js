/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports -- Expo config plugins use CommonJS. */
const { withAppDelegate } = require("@expo/config-plugins");

// Expo's scene delegate forwards URL events into AppDelegate, including cold
// launch. Keep its forwarding and React Native deep-link handling intact.
module.exports = function withGoogleUrlHandler(config) {
  return withAppDelegate(config, (result) => {
    const delegate = result.modResults;
    if (delegate.language !== "swift")
      throw new Error(
        "Google URL handling requires the Expo Swift AppDelegate."
      );
    if (delegate.contents.includes("// PocketLedger Google URL handler"))
      return result;
    const signature = /(\bopen url: URL,[\s\S]*?\) -> Bool \{)/;
    if (!signature.test(delegate.contents))
      throw new Error(
        "Review the Expo AppDelegate URL method before enabling Google sign-in."
      );
    delegate.contents =
      "import GoogleSignIn\n" +
      delegate.contents.replace(
        signature,
        "$1\n    // PocketLedger Google URL handler\n    if GIDSignIn.sharedInstance.handle(url) { return true }"
      );
    return result;
  });
};
