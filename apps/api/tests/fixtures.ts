import { randomBytes } from "node:crypto";
import { readConfig } from "../src/config.js";

export function testConfig() {
  return readConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://unused:unused@127.0.0.1/unused",
    ACCESS_TOKEN_SECRET: randomBytes(32).toString("base64url"),
    GOOGLE_CLIENT_IDS: "synthetic-web-client",
    GOOGLE_PRESENTER_IDS: "synthetic-native-client",
    CORS_ORIGINS: "https://app.example.invalid"
  });
}
