import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createMemorySession,
  consumeMemorySession,
  getMemoryLeaderboard,
  insertMemoryScore,
} from "../db/inMemory.js";
import { pool } from "../db/pool.js";
import { isDatabaseOnline } from "../db/state.js";
import { emitWebhookEvent } from "./platform.js";
import { modeSchema } from "../types.js";
import {
  extractBearerToken,
  hashClientValue,
  isReasonableScore,
  normalizeUsername,
  signSessionToken,
  usernameMeetsPolicy,
  verifySessionToken,
} from "../lib/security.js";

const router = Router();

const initSessionSchema = z.object({
  mode: modeSchema,
});

const submitScoreSchema = z.object({
  sessionId: z.string().uuid(),
  mode: modeSchema,
  username: z.string().trim().min(2).max(24).refine(usernameMeetsPolicy, "Invalid username"),
  wpm: z.number().finite().min(0).max(400),
  raw: z.number().finite().min(0).max(500),
  accuracy: z.number().finite().min(0).max(100),
  errors: z.number().int().min(0).max(5000),
  streak: z.number().int().min(0).max(5000),
  durationMs: z.number().int().min(5000).max(7_200_000),
  clientVersion: z.string().trim().max(64).optional(),
  telemetry: z
    .object({
      typedChars: z.number().int().min(0).max(50_000),
      correctChars: z.number().int().min(0).max(50_000),
      wrongChars: z.number().int().min(0).max(50_000),
      avgKeyIntervalMs: z.number().finite().min(1).max(2_000),
      burstKps: z.number().finite().min(0).max(100),
      idleRatio: z.number().finite().min(0).max(1),
      timelineHash: z.string().trim().regex(/^[a-f0-9]{64}$/i).optional(),
    })
    .optional(),
  certified: z.boolean().default(false),
});

const leaderboardQuerySchema = z.object({
  mode: modeSchema.default("time"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  certifiedOnly: z.coerce.boolean().optional().default(false),
});

function getRequestFingerprint(req: { ip?: string | undefined; get: (name: string) => string | undefined }) {
  const ip = req.ip ?? "0.0.0.0";
  const userAgent = req.get("user-agent") ?? "unknown";
  return {
    ipHash: hashClientValue(ip),
    userAgentHash: hashClientValue(userAgent),
  };
}

router.post("/session/init", async (req, res, next) => {
  try {
    const parsed = initSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid session request" });
    }

    const sessionId = randomUUID();
    const now = Date.now();
    const expiresAt = new Date(now + 15 * 60 * 1000);
    const fingerprint = getRequestFingerprint(req);

    if (isDatabaseOnline()) {
      await pool.query(
        `INSERT INTO sessions (id, mode, expires_at, ip_hash, user_agent_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, parsed.data.mode, expiresAt, fingerprint.ipHash, fingerprint.userAgentHash],
      );
    } else {
      createMemorySession({
        id: sessionId,
        mode: parsed.data.mode,
        expiresAtMs: expiresAt.getTime(),
        ipHash: fingerprint.ipHash,
        userAgentHash: fingerprint.userAgentHash,
      });
    }

    const token = signSessionToken(sessionId, parsed.data.mode);
    return res.status(201).json({
      sessionId,
      token,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/leaderboard/submit", async (req, res, next) => {
  try {
    const parsed = submitScoreSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid score payload" });
    }
    const payload = parsed.data;

    const authToken = extractBearerToken(req.get("authorization"));
    if (!authToken) {
      return res.status(401).json({ error: "Missing bearer token" });
    }

    const verified = verifySessionToken(authToken);
    if (!verified || verified.sid !== payload.sessionId || verified.mode !== payload.mode) {
      return res.status(401).json({ error: "Invalid or expired session token" });
    }

    if (!isReasonableScore(payload)) {
      return res.status(422).json({ error: "Score rejected by anti-cheat checks" });
    }
    if (payload.certified) {
      if (!payload.telemetry) {
        return res.status(422).json({ error: "Certified runs require telemetry" });
      }
      if (
        payload.durationMs < 30_000 ||
        payload.accuracy < 85 ||
        payload.telemetry.avgKeyIntervalMs < 20 ||
        payload.telemetry.burstKps > 20 ||
        payload.telemetry.idleRatio > 0.85
      ) {
        return res.status(422).json({ error: "Certified run rejected by strict validation" });
      }
    }

    const fingerprint = getRequestFingerprint(req);
    const scoreId = randomUUID();
    const username = normalizeUsername(payload.username);

    if (!isDatabaseOnline()) {
      const consumed = consumeMemorySession({
        id: payload.sessionId,
        mode: payload.mode,
        ipHash: fingerprint.ipHash,
        userAgentHash: fingerprint.userAgentHash,
      });
      if (!consumed.ok) {
        return res.status(consumed.status).json({ error: consumed.error });
      }

      const inserted = insertMemoryScore({
        id: scoreId,
        sessionId: payload.sessionId,
        username,
        mode: payload.mode,
        wpm: payload.wpm,
        raw: payload.raw,
        accuracy: payload.accuracy,
        errors: payload.errors,
        streak: payload.streak,
        durationMs: payload.durationMs,
        certified: payload.certified,
        clientVersion: payload.clientVersion ?? null,
        telemetry: payload.telemetry ?? null,
        createdAt: new Date().toISOString(),
      });
      if (!inserted.ok) {
        return res.status(500).json({ error: inserted.error });
      }

      void emitWebhookEvent("score.submitted", {
        scoreId,
        sessionId: payload.sessionId,
        mode: payload.mode,
        username,
        wpm: payload.wpm,
        accuracy: payload.accuracy,
        certified: payload.certified,
      }).catch(() => {
        // webhook delivery is best effort
      });

      return res.status(201).json({ ok: true });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const sessionResult = await client.query(
        `UPDATE sessions
            SET consumed_at = NOW()
          WHERE id = $1
            AND mode = $2
            AND consumed_at IS NULL
            AND expires_at > NOW()
          RETURNING ip_hash, user_agent_hash`,
        [payload.sessionId, payload.mode],
      );

      if (sessionResult.rowCount !== 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Session already used or expired" });
      }

      const row = sessionResult.rows[0] as { ip_hash: string; user_agent_hash: string };
      if (row.ip_hash !== fingerprint.ipHash || row.user_agent_hash !== fingerprint.userAgentHash) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Session fingerprint mismatch" });
      }

      const insertResult = await client.query(
        `INSERT INTO scores (
           id, session_id, username, mode, wpm, raw, accuracy, errors, streak, duration_ms, certified, client_version, telemetry
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
         )`,
        [
          scoreId,
          payload.sessionId,
          username,
          payload.mode,
          payload.wpm,
          payload.raw,
          payload.accuracy,
          payload.errors,
          payload.streak,
          payload.durationMs,
          payload.certified,
          payload.clientVersion ?? null,
          payload.telemetry ?? null,
        ],
      );

      if (insertResult.rowCount !== 1) {
        await client.query("ROLLBACK");
        return res.status(500).json({ error: "Failed to persist score" });
      }

      if (payload.certified) {
        await client.query(
          `UPDATE accounts
              SET verified_runs = verified_runs + 1
            WHERE handle_normalized = $1`,
          [username.toLowerCase()],
        );
      }

      await client.query("COMMIT");
      void emitWebhookEvent("score.submitted", {
        scoreId,
        sessionId: payload.sessionId,
        mode: payload.mode,
        username,
        wpm: payload.wpm,
        accuracy: payload.accuracy,
        certified: payload.certified,
      }).catch(() => {
        // webhook delivery is best effort
      });
      return res.status(201).json({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

router.get("/leaderboard", async (req, res, next) => {
  try {
    const parsed = leaderboardQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid leaderboard query" });
    }

    const { mode, limit, certifiedOnly } = parsed.data;
    if (!isDatabaseOnline()) {
      const entries = getMemoryLeaderboard(mode, limit, certifiedOnly).map((row, index) => ({
        rank: index + 1,
        username: row.username,
        mode: row.mode,
        wpm: Number(row.wpm),
        raw: Number(row.raw),
        accuracy: Number(row.accuracy),
        errors: row.errors,
        streak: row.streak,
        durationMs: row.durationMs,
        certified: row.certified,
        createdAt: row.createdAt,
      }));
      return res.json({ mode, certifiedOnly, entries });
    }

    const result = await pool.query(
      `SELECT username, mode, wpm, raw, accuracy, errors, streak, duration_ms, certified, created_at
         FROM scores
        WHERE mode = $1
          AND ($2::boolean = FALSE OR certified = TRUE)
        ORDER BY wpm DESC, accuracy DESC, raw DESC, created_at ASC
        LIMIT $3`,
      [mode, certifiedOnly, limit],
    );

    return res.json({
      mode,
      certifiedOnly,
      entries: result.rows.map((row, index) => ({
        rank: index + 1,
        username: row.username,
        mode: row.mode,
        wpm: Number(row.wpm),
        raw: Number(row.raw),
        accuracy: Number(row.accuracy),
        errors: row.errors,
        streak: row.streak,
        durationMs: row.duration_ms,
        certified: Boolean(row.certified),
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

export { router as leaderboardRouter };
