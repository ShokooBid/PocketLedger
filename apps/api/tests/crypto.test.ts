import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { accessToken, verifyAccess } from "../src/auth/crypto.js";
import { testConfig } from "./fixtures.js";

describe("PocketLedger access proof", () => {
  const config = testConfig();
  const now = new Date();
  const userId = randomUUID();
  const sessionId = randomUUID();
  it("validates signed user/session claims", async () => {
    const token = await accessToken(
      config,
      userId,
      sessionId,
      now,
      new Date(now.getTime() + 60000)
    );
    expect(await verifyAccess(config, token, now)).toEqual({
      userId,
      sessionId
    });
  });
  it.each([
    { iss: "wrong-issuer" },
    { aud: "wrong-audience" },
    { sid: randomUUID(), sub: "client-injected" },
    { sid: "invalid-session" },
    { iat: undefined },
    { exp: undefined },
    { sid: undefined },
    { iat: Math.floor(now.getTime() / 1000) + 100 }
  ])("rejects invalid claims %j", async (extra: Record<string, unknown>) => {
    const token = await new SignJWT({
      sub: userId,
      sid: sessionId,
      iss: config.issuer,
      aud: config.audience,
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(now.getTime() / 1000) + 60,
      ...extra
    })
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
      .sign(config.tokenKey);
    await expect(verifyAccess(config, token, now)).rejects.toMatchObject({
      status: 401
    });
  });
  it("rejects another token type", async () => {
    const token = await new SignJWT({ sid: sessionId })
      .setSubject(userId)
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setIssuedAt()
      .setExpirationTime("1m")
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .sign(config.tokenKey);
    await expect(verifyAccess(config, token, now)).rejects.toMatchObject({
      status: 401
    });
  });
});
