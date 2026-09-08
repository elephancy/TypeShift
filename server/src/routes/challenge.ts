import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import {
  consumeMemorySession,
  getMemoryChallengeLeaderboard,
  getMemorySeasonLeaderboard,
  insertMemoryChallengeScore,
} from "../db/inMemory.js";
import { pool } from "../db/pool.js";
import { isDatabaseOnline } from "../db/state.js";
import { modeSchema, type Mode } from "../types.js";
import {
  extractBearerToken,
  hashClientValue,
  isReasonableScore,
  normalizeUsername,
  usernameMeetsPolicy,
  verifySessionToken,
} from "../lib/security.js";

interface DailyChallengeDefinition {
  id: string;
  date: string;
  mode: Mode;
  durationSec: number;
  dictionaryPack: "top1k" | "top5k" | "top10k" | "verbs" | "nouns" | "core" | "tech";
  seed: number;
}

interface SeasonWindow {
  id: string;
  startDate: string;
  endDate: string;
}

const challengeModes: Mode[] = ["time", "relay", "pulse", "cipher", "duel"];
const challengeDictionaries: DailyChallengeDefinition["dictionaryPack"][] = [
  "top1k",
  "top5k",
  "top10k",
  "verbs",
  "nouns",
  "core",
  "tech",
];
const challengeDurations = [45, 60, 75, 90];

const challengeSubmitSchema = z.object({
  sessionId: z.string().uuid(),
  challengeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: modeSchema,
  username: z.string().trim().min(2).max(24).refine(usernameMeetsPolicy, "Invalid username"),
  wpm: z.number().finite().min(0).max(400),
  raw: z.number().finite().min(0).max(500),
  accuracy: z.number().finite().min(0).max(100),
  errors: z.number().int().min(0).max(5000),
  streak: z.number().int().min(0).max(5000),
  durationMs: z.number().int().min(5000).max(7_200_000),
});

const challengeLeaderboardQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const seasonLeaderboardQuerySchema = z.object({
  seasonId: z.string().regex(/^\d{4}-Q[1-4]$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

function getRequestFingerprint(req: { ip?: string | undefined; get: (name: string) => string | undefined }) {
  const ip = req.ip ?? "0.0.0.0";
  const userAgent = req.get("user-agent") ?? "unknown";
  return {
    ipHash: hashClientValue(ip),
    userAgentHash: hashClientValue(userAgent),
  };
}

function toIsoDateUtc(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getDailyChallenge(now = new Date()): DailyChallengeDefinition {
  const date = toIsoDateUtc(now);
  const hash = hashString(`typeshift-daily-${date}`);
  const mode = challengeModes[hash % challengeModes.length] ?? "time";
  const dictionaryPack =
    challengeDictionaries[Math.floor(hash / 13) % challengeDictionaries.length] ?? "top1k";
  const durationSec =
    challengeDurations[Math.floor(hash / 101) % challengeDurations.length] ?? 60;

  return {
    id: date,
    date,
    mode,
    durationSec,
    dictionaryPack,
    seed: hash,
  };
}

function getSeasonWindow(date = new Date()): SeasonWindow {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const quarter = Math.floor(month / 3) + 1;
  const startMonth = (quarter - 1) * 3;
  const endMonth = startMonth + 3;
  const start = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, endMonth, 1, 0, 0, 0, 0));
  return {
    id: `${year}-Q${quarter}`,
    startDate: toIsoDateUtc(start),
    endDate: toIsoDateUtc(end),
  };
}

function parseSeasonId(seasonId: string): SeasonWindow {
  const [yearPart, quarterPart] = seasonId.split("-Q");
  const year = Number(yearPart);
  const quarter = Number(quarterPart);
  const startMonth = (quarter - 1) * 3;
  const endMonth = startMonth + 3;
  const start = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, endMonth, 1, 0, 0, 0, 0));
  return {
    id: `${year}-Q${quarter}`,
    startDate: toIsoDateUtc(start),
    endDate: toIsoDateUtc(end),
  };
}

function pointsForChallengeScore(payload: {
  wpm: number;
  accuracy: number;
  errors: number;
  streak: number;
  raw: number;
}): number {
  const pace = payload.wpm * (payload.accuracy / 100);
  const precisionBonus = Math.max(0, payload.raw - payload.wpm) * 0.8;
  const streakBonus = payload.streak * 2.2;
  const penalty = payload.errors * 3.5;
  return Math.max(0, Math.round(pace * 10 + precisionBonus + streakBonus - penalty));
}

const router = Router();

router.get("/challenge/daily", (_req, res) => {
  const challenge = getDailyChallenge();
  const season = getSeasonWindow();
  return res.json({
    challenge,
    season,
  });
});

router.post("/challenge/submit", async (req, res, next) => {
  try {
    const parsed = challengeSubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid challenge score payload" });
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

    const challenge = getDailyChallenge();
    if (payload.challengeDate !== challenge.date) {
      return res.status(422).json({ error: "Challenge date does not match today's challenge" });
    }
    if (payload.mode !== challenge.mode) {
      return res.status(422).json({ error: "Score mode does not match today's challenge mode" });
    }
    const expectedDurationMs = challenge.durationSec * 1000;
    if (Math.abs(payload.durationMs - expectedDurationMs) > 15_000) {
      return res.status(422).json({ error: "Score duration does not match today's challenge duration" });
    }

    const fingerprint = getRequestFingerprint(req);
    const scoreId = randomUUID();
    const username = normalizeUsername(payload.username);
    const points = pointsForChallengeScore(payload);

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

      const inserted = insertMemoryChallengeScore({
        id: scoreId,
        sessionId: payload.sessionId,
        challengeDate: payload.challengeDate,
        username,
        mode: payload.mode,
        wpm: payload.wpm,
        raw: payload.raw,
        accuracy: payload.accuracy,
        errors: payload.errors,
        streak: payload.streak,
        durationMs: payload.durationMs,
        points,
        createdAt: new Date().toISOString(),
      });
      if (!inserted.ok) {
        return res.status(500).json({ error: inserted.error });
      }

      return res.status(201).json({ ok: true, points });
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

      await client.query(
        `INSERT INTO challenge_scores (
           id, session_id, challenge_date, username, mode, wpm, raw, accuracy, errors, streak, duration_ms, points
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
         )`,
        [
          scoreId,
          payload.sessionId,
          payload.challengeDate,
          username,
          payload.mode,
          payload.wpm,
          payload.raw,
          payload.accuracy,
          payload.errors,
          payload.streak,
          payload.durationMs,
          points,
        ],
      );

      await client.query("COMMIT");
      return res.status(201).json({ ok: true, points });
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

router.get("/challenge/leaderboard", async (req, res, next) => {
  try {
    const parsed = challengeLeaderboardQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid challenge leaderboard query" });
    }
    const challengeDate = parsed.data.date ?? getDailyChallenge().date;
    const limit = parsed.data.limit;

    if (!isDatabaseOnline()) {
      const entries = getMemoryChallengeLeaderboard(challengeDate, limit).map((row, index) => ({
        rank: index + 1,
        username: row.username,
        mode: row.mode,
        points: row.points,
        wpm: Number(row.wpm),
        raw: Number(row.raw),
        accuracy: Number(row.accuracy),
        errors: row.errors,
        streak: row.streak,
        durationMs: row.durationMs,
        createdAt: row.createdAt,
      }));
      return res.json({ date: challengeDate, entries });
    }

    const result = await pool.query(
      `SELECT username, mode, points, wpm, raw, accuracy, errors, streak, duration_ms, created_at
         FROM challenge_scores
        WHERE challenge_date = $1
        ORDER BY points DESC, wpm DESC, accuracy DESC, raw DESC, created_at ASC
        LIMIT $2`,
      [challengeDate, limit],
    );

    return res.json({
      date: challengeDate,
      entries: result.rows.map((row, index) => ({
        rank: index + 1,
        username: row.username,
        mode: row.mode,
        points: Number(row.points),
        wpm: Number(row.wpm),
        raw: Number(row.raw),
        accuracy: Number(row.accuracy),
        errors: row.errors,
        streak: row.streak,
        durationMs: row.duration_ms,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/season/current", (_req, res) => {
  const season = getSeasonWindow();
  const challenge = getDailyChallenge();
  return res.json({ season, challengeDate: challenge.date });
});

router.get("/season/leaderboard", async (req, res, next) => {
  try {
    const parsed = seasonLeaderboardQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid season leaderboard query" });
    }
    const season = parsed.data.seasonId ? parseSeasonId(parsed.data.seasonId) : getSeasonWindow();
    const limit = parsed.data.limit;
    const startIso = `${season.startDate}T00:00:00.000Z`;
    const endIso = `${season.endDate}T00:00:00.000Z`;

    if (!isDatabaseOnline()) {
      const entries = getMemorySeasonLeaderboard(startIso, endIso, limit).map((row, index) => ({
        rank: index + 1,
        username: row.username,
        points: row.points,
        runs: row.runs,
        bestWpm: Number(row.bestWpm.toFixed(2)),
      }));
      return res.json({ season, entries });
    }

    const result = await pool.query(
      `WITH base_scores AS (
         SELECT username,
                GREATEST(0, FLOOR((wpm * (accuracy / 100.0)) * 10) - (errors * 2) + streak)::int AS points,
                wpm
           FROM scores
          WHERE created_at >= $1::timestamptz
            AND created_at < $2::timestamptz
       ),
       challenge_scores_scored AS (
         SELECT username,
                GREATEST(0, points + 50)::int AS points,
                wpm
           FROM challenge_scores
          WHERE created_at >= $1::timestamptz
            AND created_at < $2::timestamptz
       ),
       combined AS (
         SELECT username, points, wpm FROM base_scores
         UNION ALL
         SELECT username, points, wpm FROM challenge_scores_scored
       )
       SELECT username,
              SUM(points)::int AS points,
              COUNT(*)::int AS runs,
              MAX(wpm)::numeric AS best_wpm
         FROM combined
        GROUP BY username
        ORDER BY points DESC, best_wpm DESC, runs DESC, username ASC
        LIMIT $3`,
      [startIso, endIso, limit],
    );

    return res.json({
      season,
      entries: result.rows.map((row, index) => ({
        rank: index + 1,
        username: row.username,
        points: Number(row.points),
        runs: Number(row.runs),
        bestWpm: Number(row.best_wpm),
      })),
    });
  } catch (error) {
    return next(error);
  }
});

export {
  router as challengeRouter,
  getDailyChallenge,
  getSeasonWindow,
  parseSeasonId,
  pointsForChallengeScore,
};
