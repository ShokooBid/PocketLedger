import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import type { Config } from "../config.js";
import { invalidCredentials } from "../errors.js";

const claims = z.object({
  sub: z
    .string()
    .min(1)
    .max(255)
    .refine((value) => value.trim().length > 0),
  nonce: z.string().min(1),
  email: z.email().max(254).optional(),
  email_verified: z.boolean().optional(),
  azp: z.string().optional(),
  aud: z.union([z.string(), z.array(z.string())])
});

export function googleVerifier(
  config: Config,
  keys: JWTVerifyGetKey = createRemoteJWKSet(
    new URL("https://www.googleapis.com/oauth2/v3/certs"),
    { timeoutDuration: 5000 }
  )
) {
  return async (token: string, nonce: string, now: Date) => {
    try {
      if (!config.googleAudiences.length) throw invalidCredentials();
      const { payload } = await jwtVerify(token, keys, {
        algorithms: ["RS256"],
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: config.googleAudiences,
        currentDate: now,
        requiredClaims: ["sub", "aud", "iss", "iat", "exp", "nonce"]
      });
      const proof = claims.parse(payload);
      if (
        proof.nonce !== nonce ||
        typeof payload.iat !== "number" ||
        payload.iat > now.getTime() / 1000 ||
        (Array.isArray(proof.aud) && proof.aud.length > 1 && !proof.azp) ||
        (proof.azp !== undefined &&
          !config.googlePresenters.includes(proof.azp))
      )
        throw invalidCredentials();
      return {
        subject: proof.sub,
        email: proof.email?.trim().toLowerCase(),
        verifiedEmail: proof.email_verified === true
      };
    } catch {
      throw invalidCredentials();
    }
  };
}

export type GoogleVerifier = ReturnType<typeof googleVerifier>;
