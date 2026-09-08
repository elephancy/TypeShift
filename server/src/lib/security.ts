import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import type { Mode } from "../types.js";

const TOKEN_ISSUER = "typeshift-api";
const TOKEN_AUDIENCE = "typeshift-client";
const ACCOUNT_TOKEN_AUDIENCE = "typeshift-account";
const JWT_ALGORITHM = "HS512";
const USERNAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9 _.-]{0,22}[A-Za-z0-9])?$/;

interface SessionTokenPayload {
  sid: string;
  mode: Mode;
}

interface AccountTokenPayload {
  aid: string;
  handle: string;
  sid: string;
}

export function hashClientValue(input: string): string {
  return crypto
    .createHmac("sha256", config.JWT_SESSION_SECRET)
    .update(input)
    .digest("hex");
}

export function extractBearerToken(header?: string): string | null {
  if (!header) {
    return null;
  }
  const [scheme, token] = header.trim().split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token;
}

export function safeTokenCompare(expected?: string, candidate?: string): boolean {
  if (!expected || !candidate) {
    return false;
  }
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(candidate, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

export function signSessionToken(sessionId: string, mode: Mode): string {
  return jwt.sign({ sid: sessionId, mode }, config.JWT_SESSION_SECRET, {
    algorithm: JWT_ALGORITHM,
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
    expiresIn: "15m",
  });
}

export function verifySessionToken(token: string): SessionTokenPayload | null {
  try {
    const payload = jwt.verify(token, config.JWT_SESSION_SECRET, {
      algorithms: [JWT_ALGORITHM],
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    }) as SessionTokenPayload;
    if (!payload.sid || !payload.mode) {
      return null;
    }
    return payload;
  } catch (_error) {
    return null;
  }
}

export function signAccountToken(sessionId: string, accountId: string, handle: string): string {
  return jwt.sign({ aid: accountId, handle, sid: sessionId }, config.JWT_SESSION_SECRET, {
    algorithm: JWT_ALGORITHM,
    issuer: TOKEN_ISSUER,
    audience: ACCOUNT_TOKEN_AUDIENCE,
    expiresIn: "30d",
  });
}

export function verifyAccountToken(token: string): AccountTokenPayload | null {
  try {
    const payload = jwt.verify(token, config.JWT_SESSION_SECRET, {
      algorithms: [JWT_ALGORITHM],
      issuer: TOKEN_ISSUER,
      audience: ACCOUNT_TOKEN_AUDIENCE,
    }) as AccountTokenPayload;
    if (!payload.aid || !payload.handle || !payload.sid) {
      return null;
    }
    return payload;
  } catch (_error) {
    return null;
  }
}

export function passwordMeetsPolicy(password: string): boolean {
  if (password.length < 10 || password.length > 128) {
    return false;
  }
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  return hasUpper && hasLower && hasDigit;
}

export function createPasswordHash(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

export function verifyPasswordHash(password: string, salt: string, expectedHash: string): boolean {
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return safeTokenCompare(expectedHash, candidate);
}

export function normalizeUsername(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^A-Za-z0-9 _.-]/g, "");
}

export function usernameMeetsPolicy(raw: string): boolean {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  const username = normalizeUsername(raw);
  if (username !== collapsed) {
    return false;
  }
  return username.length >= 2 && username.length <= 24 && USERNAME_PATTERN.test(username);
}

export function normalizeDisplayName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^A-Za-z0-9 _.-]/g, "");
}

export function displayNameMeetsPolicy(raw: string, maxLen = 48): boolean {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  const value = normalizeDisplayName(raw);
  if (value !== collapsed) {
    return false;
  }
  if (value.length < 2 || value.length > maxLen) {
    return false;
  }
  return /^[A-Za-z0-9 _.-]+$/.test(value);
}

export function isReasonableScore(payload: {
  wpm: number;
  raw: number;
  accuracy: number;
  durationMs: number;
  errors: number;
  telemetry?: {
    typedChars: number;
    correctChars: number;
    wrongChars: number;
    avgKeyIntervalMs: number;
    burstKps: number;
    idleRatio: number;
    timelineHash?: string | undefined;
  } | undefined;
}): boolean {
  if (payload.raw < payload.wpm) {
    return false;
  }
  if (payload.wpm > 320 || payload.raw > 380) {
    return false;
  }
  if (payload.durationMs < 12_000 && payload.wpm > 170) {
    return false;
  }
  if (payload.durationMs < 7_000) {
    return false;
  }
  if (payload.accuracy < 45 && payload.wpm > 130) {
    return false;
  }
  if (payload.errors > 2_500) {
    return false;
  }
  if (payload.telemetry) {
    const telemetry = payload.telemetry;
    if (telemetry.typedChars + 400 < telemetry.correctChars) {
      return false;
    }
    if (telemetry.avgKeyIntervalMs < 8 || telemetry.avgKeyIntervalMs > 1_000) {
      return false;
    }
    if (telemetry.burstKps > 35) {
      return false;
    }
    if (telemetry.idleRatio > 0.98 || telemetry.idleRatio < 0) {
      return false;
    }
    if (telemetry.timelineHash && !/^[a-f0-9]{64}$/i.test(telemetry.timelineHash)) {
      return false;
    }
  }
  return true;
}
