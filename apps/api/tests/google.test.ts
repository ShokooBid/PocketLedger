import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { googleVerifier } from "../src/auth/google.js";
import { testConfig } from "./fixtures.js";

const config = testConfig();
const now = new Date();
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let verify: ReturnType<typeof googleVerifier>;
beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  const jwk = await exportJWK(keys.publicKey);
  verify = googleVerifier(
    config,
    createLocalJWKSet({ keys: [{ ...jwk, kid: "synthetic", alg: "RS256" }] })
  );
});

async function token(
  overrides: Record<string, unknown> = {},
  key = keys.privateKey
) {
  return new SignJWT({
    sub: "synthetic-subject",
    nonce: "synthetic-nonce",
    email: "Synthetic@Example.invalid",
    email_verified: true,
    iss: "https://accounts.google.com",
    aud: "synthetic-web-client",
    azp: "synthetic-native-client",
    iat: Math.floor(now.getTime() / 1000),
    exp: Math.floor(now.getTime() / 1000) + 300,
    ...overrides
  })
    .setProtectedHeader({ alg: "RS256", kid: "synthetic" })
    .sign(key);
}

describe("Google ID proof verification with local keys", () => {
  it("verifies signed identity and normalizes contact email", async () => {
    expect(await verify(await token(), "synthetic-nonce", now)).toEqual({
      subject: "synthetic-subject",
      email: "synthetic@example.invalid",
      verifiedEmail: true
    });
  });
  it.each([
    { iss: "https://attacker.example.invalid" },
    { aud: "wrong-client" },
    { azp: "wrong-presenter" },
    { exp: Math.floor(now.getTime() / 1000) - 1 },
    { nonce: "wrong-nonce" },
    { sub: "" },
    { nonce: undefined },
    { sub: undefined },
    { exp: undefined },
    { iat: undefined },
    { aud: ["synthetic-web-client", "second"], azp: undefined },
    { iat: Math.floor(now.getTime() / 1000) + 100 },
    { email_verified: "true" }
  ])("rejects invalid claims %j", async (overrides) => {
    await expect(
      verify(await token(overrides), "synthetic-nonce", now)
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });
  it("rejects a wrong signature", async () => {
    const other = await generateKeyPair("RS256");
    await expect(
      verify(await token({}, other.privateKey), "synthetic-nonce", now)
    ).rejects.toMatchObject({ status: 401 });
  });
  it("fails safely when key retrieval fails or Google is unconfigured", async () => {
    const failed = googleVerifier(config, async () => {
      throw new Error("synthetic provider failure");
    });
    await expect(
      failed(await token(), "synthetic-nonce", now)
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(
      googleVerifier({ ...config, googleAudiences: [] })(
        await token(),
        "synthetic-nonce",
        now
      )
    ).rejects.toMatchObject({ status: 401 });
  });
});
