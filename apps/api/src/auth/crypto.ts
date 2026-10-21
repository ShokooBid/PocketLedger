import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { jwtVerify, SignJWT } from "jose";
import type { Config } from "../config.js";
import { invalidCredentials } from "../errors.js";

export const randomToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const hashPassword = (password: string) =>
  argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1
  });

// One adaptive operation also runs for absent, disabled and malformed credentials.
export async function passwordVerifier() {
  const dummyHash = await hashPassword(randomToken());
  return async (hash: string | null | undefined, password: string) => {
    if (!hash?.startsWith("$argon2id$")) {
      await argon2.verify(dummyHash, password);
      return false;
    }
    try {
      return await argon2.verify(hash, password);
    } catch {
      await argon2.verify(dummyHash, password);
      return false;
    }
  };
}

export async function accessToken(
  config: Config,
  userId: string,
  sessionId: string,
  now: Date,
  expires: Date
) {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
    .setSubject(userId)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(expires.getTime() / 1000))
    .sign(config.tokenKey);
}

export async function verifyAccess(config: Config, token: string, now: Date) {
  try {
    const { payload } = await jwtVerify(token, config.tokenKey, {
      algorithms: ["HS256"],
      typ: "at+jwt",
      issuer: config.issuer,
      audience: config.audience,
      currentDate: now,
      requiredClaims: ["sub", "sid", "iat", "exp"]
    });
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (
      typeof payload.sub !== "string" ||
      !uuid.test(payload.sub) ||
      typeof payload.sid !== "string" ||
      !uuid.test(payload.sid) ||
      typeof payload.iat !== "number" ||
      payload.iat > now.getTime() / 1000
    )
      throw invalidCredentials();
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    throw invalidCredentials();
  }
}
