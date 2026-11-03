/* eslint-disable @next/next/no-html-link-for-pages */
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import BrandLogo from "./components/BrandLogo";
import SiteFooter from "./components/SiteFooter";
import TurnstileWidget from "./components/TurnstileWidget";
import {
  createWebhook,
  createRaceRoom,
  createTournament,
  changeAccountPassword,
  deleteWebhook,
  deleteAccount,
  deleteAdminLeaderboardScore,
  deleteAdminUser,
  enqueueCasualDuel,
  enqueueRanked,
  exportAccountData,
  fetchAccountProfile,
  fetchAccountSessions,
  fetchAdminLeaderboard,
  fetchAdminUsers,
  fetchAnalyticsSummary,
  fetchChallengeLeaderboard,
  fetchCurrentSeason,
  fetchDailyChallenge,
  fetchDuelState,
  fetchFriends,
  fetchLeaderboard,
  fetchRaceRoomState,
  fetchRankedStatus,
  fetchSharedReplay,
  fetchSeasonLeaderboard,
  fetchTournamentState,
  flushQueuedScores,
  initSession,
  installOfflineSyncHooks,
  joinRaceRoom,
  listReplayShares,
  listWebhooks,
  loginAccount,
  logoutCurrentAccount,
  logoutOtherAccountSessions,
  registerAccount,
  revokeAccountSession,
  reportTournamentMatch,
  requestFriend,
  respondFriend,
  seedBotLeaderboard,
  shareReplay,
  startRaceRoom,
  submitScore,
  submitChallengeScore,
  testWebhook,
  sendPrivacyAnalytics,
  updateAccountPreferences,
  updateDuelState,
  updateRaceProgress,
  ApiError,
  type AccountProfile,
  type AccountSessionEntry,
  type AdminLeaderboardEntry,
  type AdminUserEntry,
  type AnalyticsSummaryResponse,
  type ChallengeLeaderboardEntry,
  type DailyChallenge,
  type DuelState,
  type FriendListResponse,
  type LeaderboardEntry,
  type Mode,
  type RaceRoomState,
  type ReplayShareEntry,
  type SeasonLeaderboardEntry,
  type SeasonWindow,
  type TournamentState,
  type WebhookEndpoint,
} from "./lib/api";
import {
  buildDictionaryPool,
  generateWords,
  loadFrequencyDictionary,
  loadLargeDictionary,
  splitCustomWords,
  type DictionaryPack,
} from "./lib/dictionary";
import { generateCodePrompt, type CodeIndentMode, type CodeLanguage } from "./lib/code-prompts";
import { chooseMeteorTarget } from "./lib/meteor-targeting";
import { GAME_MODES, MODE_DETAILS, MODE_META, modeFromSlug, pathForMode } from "./lib/game-modes";

const STORAGE_CUSTOM = "typeshift.customWords";
const STORAGE_BEST = "typeshift.bestByMode";
const STORAGE_THEME = "typeshift.theme";
const STORAGE_FOCUS_PREFS = "typeshift.focusPrefs.v1";
const STORAGE_CIPHER_PREFS = "typeshift.cipherPrefs.v1";
const STORAGE_PULSE_PREFS = "typeshift.pulsePrefs.v1";
const STORAGE_SOUND_PACK = "typeshift.soundPack.v1";
const STORAGE_ACCESSIBILITY = "typeshift.accessibilityPreset.v1";
const STORAGE_A11Y_PREFS = "typeshift.a11yPrefs.v1";
const STORAGE_WEAKNESS_MAP = "typeshift.weaknessMap.v1";
const STORAGE_KEY_STATS = "typeshift.keyStats.v1";
const STORAGE_GHOSTS = "typeshift.ghostRuns.v1";
const STORAGE_REPLAYS = "typeshift.replays.v1";
const STORAGE_RACE_META = "typeshift.raceMeta.v1";
const STORAGE_ACCOUNT_TOKEN = "typeshift.accountToken.v1";
const STORAGE_ACCOUNT_PROFILE = "typeshift.accountProfile.v1";
const STORAGE_ACCOUNT_PREFS = "typeshift.accountPrefs.v1";
const STORAGE_PRIVACY_CONSENT = "typeshift.privacyConsent.v1";
const PRIVACY_CONSENT_VERSION = 1;

const QUOTES = [
  "Calm typing beats rushed typing every time.",
  "Look ahead one word and keep your hands loose.",
  "Clean runs come from small accurate movements.",
  "Stay steady and speed will show up on its own.",
  "Mistakes cost less when you catch them early.",
];

const QUOTE_OPENERS = [
  "A steady rhythm",
  "Careful practice",
  "The quiet run",
  "Fast progress",
  "Good focus",
  "A clean mistake",
  "The next word",
  "Sharp accuracy",
  "Patient speed",
  "Small corrections",
  "Daily training",
  "A relaxed hand",
  "The best sprint",
  "Clear attention",
  "Better typing",
  "A calm reset",
  "The strongest pace",
  "Every clean line",
  "A focused session",
  "The final word",
];

const QUOTE_MIDDLES = [
  "starts before the first key",
  "comes from reading ahead",
  "turns hesitation into control",
  "keeps pressure from becoming noise",
  "makes speed easier to trust",
  "builds from one honest correction",
  "stays smooth when the timer gets loud",
  "rewards the hands that do less",
  "keeps the eyes moving forward",
  "removes panic from the run",
  "finds space between two thoughts",
  "makes every miss easier to study",
  "keeps the line light and readable",
  "comes from listening to the pattern",
  "lets the next word arrive early",
  "turns repetition into confidence",
  "keeps the keyboard feeling simple",
  "makes hard words feel smaller",
  "moves faster when it stops rushing",
  "keeps the whole run honest",
];

const QUOTE_ENDINGS = [
  "when accuracy stays first.",
  "while the cursor keeps moving.",
  "if the next word is already visible.",
  "because smooth hands waste less time.",
  "when every correction teaches something.",
  "without turning the run into a fight.",
  "as soon as the eyes stop chasing.",
  "when the rhythm survives one mistake.",
  "because clean lines carry speed.",
  "while attention stays on the lane.",
  "if pressure never owns the keyboard.",
  "when the hands stay loose.",
  "because a reset is not a failure.",
  "while the timer becomes background noise.",
  "if the word shape is clear.",
  "when practice has a specific target.",
  "because the best run is readable.",
  "while small wins keep stacking.",
  "when the sentence has room to breathe.",
  "because consistency beats panic.",
];

function pickQuote(): string {
  if (Math.random() < 0.12) {
    return QUOTES[Math.floor(Math.random() * QUOTES.length)] ?? QUOTES[0]!;
  }
  const opener = QUOTE_OPENERS[Math.floor(Math.random() * QUOTE_OPENERS.length)] ?? QUOTE_OPENERS[0]!;
  const middle = QUOTE_MIDDLES[Math.floor(Math.random() * QUOTE_MIDDLES.length)] ?? QUOTE_MIDDLES[0]!;
  const ending = QUOTE_ENDINGS[Math.floor(Math.random() * QUOTE_ENDINGS.length)] ?? QUOTE_ENDINGS[0]!;
  return `${opener} ${middle} ${ending}`;
}

export type AppRoute = "home" | "play" | "social" | "boards" | "lab" | "profile" | "privacy" | "settings";
type ProfileSubroute =
  | "overview"
  | "account"
  | "security"
  | "data"
  | "friends"
  | "duels"
  | "replays"
  | "webhooks"
  | "admin";
const ADMIN_HANDLES = new Set(
  (process.env.NEXT_PUBLIC_ADMIN_HANDLES ?? "")
    .split(",")
    .map((handle) => handle.trim().toLowerCase())
    .filter(Boolean),
);

const ROUTE_LABELS: Record<AppRoute, string> = {
  home: "Home",
  play: "Games",
  social: "Social",
  boards: "Boards",
  lab: "Lab",
  profile: "Profile",
  privacy: "Privacy",
  settings: "Settings",
};

const ROUTE_GROUPS: Array<{ label: string; routes: AppRoute[] }> = [
  { label: "Start", routes: ["home", "play"] },
  { label: "Community", routes: ["social", "boards", "lab"] },
  { label: "System", routes: ["settings"] },
];
const DICTIONARY_QA_PACKS: DictionaryPack[] = [
  "core",
  "tech",
  "myth",
  "blitz",
  "top1k",
  "top5k",
  "top10k",
  "verbs",
  "nouns",
  "code",
];

const ROUTE_COPY: Record<AppRoute, { title: string; subtitle: string }> = {
  home: {
    title: "TypeShift HQ",
    subtitle: "Home dashboard with quick launch, profile snapshot, and active ladders.",
  },
  play: {
    title: "Games",
    subtitle: "Choose a game, then play it without sidebars or unrelated controls.",
  },
  social: {
    title: "Social Hub",
    subtitle: "Create race rooms, run brackets, queue duels, and manage friends on the Worker API.",
  },
  boards: {
    title: "Rank Boards",
    subtitle: "Track global runs, daily challenge, and current season ladder.",
  },
  lab: {
    title: "Training Lab",
    subtitle: "Build custom dictionaries, review replays, and inspect heatmaps.",
  },
  profile: {
    title: "Pilot Profile",
    subtitle: "Account sync, sessions, friends, replay sharing, duel queues, and webhook endpoints.",
  },
  privacy: {
    title: "Privacy Desk",
    subtitle: "Consent controls, storage rules, cookie policy, and aggregate analytics.",
  },
  settings: {
    title: "System Settings",
    subtitle: "Tune performance, accessibility, and focus HUD behavior.",
  },
};

function routeFromPathname(pathname: string): AppRoute {
  const normalized = pathname.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  if (normalized === "/" || normalized === "/home") return "home";
  if (normalized === "/modes") return "play";
  if (normalized === "/social") return "social";
  if (normalized === "/boards") return "boards";
  if (normalized === "/lab") return "lab";
  if (normalized === "/profile" || normalized.startsWith("/profile/")) return "profile";
  if (normalized === "/privacy") return "privacy";
  if (normalized === "/settings") return "settings";
  if (normalized === "/play" || normalized === "/games" || normalized.startsWith("/games/")) return "play";
  return "home";
}

function pathForRoute(route: AppRoute): string {
  if (route === "home") return "/";
  if (route === "play") return "/games";
  return `/${route}`;
}

const MODE_GLYPHS: Record<Mode, string> = {
  time: "↗",
  quote: "“",
  meteor: "●",
  zen: "≈",
  pulse: "⌁",
  relay: "↔",
  cipher: "⌘",
  drift: "⋯",
  reverse: "←",
  echo: "))",
  rogue: "◆",
  duel: "×",
  code: "</>",
  coach: "!",
  blackout: "◐",
  chain: "∞",
  gravity: "↕",
  coop: "+",
  infection: "✣",
  stealth: "◒",
  chart: "▥",
};

function modeFromPathname(pathname: string): Mode | null {
  const normalized = pathname.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  const [, section, slug] = normalized.split("/");
  if (section !== "games" || !slug) {
    return null;
  }
  return modeFromSlug(slug);
}

function profileSubrouteFromPathname(pathname: string): ProfileSubroute {
  const normalized = pathname.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  if (normalized === "/profile/account") return "account";
  if (normalized === "/profile/security") return "security";
  if (normalized === "/profile/data") return "data";
  if (normalized === "/profile/friends") return "friends";
  if (normalized === "/profile/duels") return "duels";
  if (normalized === "/profile/replays") return "replays";
  if (normalized === "/profile/webhooks") return "webhooks";
  if (normalized === "/profile/admin") return "admin";
  return "overview";
}

function pathForProfileSubroute(route: ProfileSubroute): string {
  if (route === "overview") return "/profile";
  return `/profile/${route}`;
}

function viewportBucket(width: number): "sm" | "md" | "lg" | "xl" {
  if (width < 640) return "sm";
  if (width < 960) return "md";
  if (width < 1280) return "lg";
  return "xl";
}

function handleLooksValid(input: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9 _.-]{0,22}[A-Za-z0-9])?$/.test(input.trim());
}

function passwordLooksValid(input: string): boolean {
  return input.length >= 10 && /[A-Z]/.test(input) && /[a-z]/.test(input) && /\d/.test(input);
}

function readStoredPrivacyConsent(): PrivacyConsent | null {
  try {
    const stored = localStorage.getItem(STORAGE_PRIVACY_CONSENT);
    if (!stored) {
      return null;
    }
    const parsed = JSON.parse(stored) as Partial<PrivacyConsent>;
    if (parsed && parsed.version === PRIVACY_CONSENT_VERSION) {
      return {
        version: PRIVACY_CONSENT_VERSION,
        analytics: parsed.analytics === true,
        preferences: parsed.preferences === true,
        decidedAt: typeof parsed.decidedAt === "string" ? parsed.decidedAt : new Date().toISOString(),
      };
    }
    return null;
  } catch (_error) {
    return null;
  }
}

type RuntimeStatus = "idle" | "running" | "finished";
type ThemeMode = "dark" | "light";
type CipherDirection = "forward" | "backward";
type PulseJudgeTone = "perfect" | "great" | "ok" | "miss";
type SoundPack = "arcade" | "retro" | "cinematic" | "soft" | "mute";
type AccessibilityPreset = "standard" | "reduced" | "contrast" | "colorblind" | "dyslexia";
type WordShape = "compact" | "balanced" | "wide" | "wild";

interface ModeTuning {
  wordShape: WordShape;
  intensity: number;
  strictness: number;
  density: number;
  reveal: number;
  intervalSec: number;
  spread: number;
  perkEvery: number;
  rivalPace: number;
  teamSize: number;
}

const DEFAULT_MODE_TUNING: Record<Mode, ModeTuning> = {
  time: { wordShape: "balanced", intensity: 3, strictness: 3, density: 4, reveal: 1, intervalSec: 6, spread: 2, perkEvery: 20, rivalPace: 92, teamSize: 2 },
  quote: { wordShape: "wide", intensity: 2, strictness: 2, density: 4, reveal: 1, intervalSec: 6, spread: 2, perkEvery: 20, rivalPace: 92, teamSize: 2 },
  meteor: { wordShape: "compact", intensity: 2, strictness: 3, density: 4, reveal: 1, intervalSec: 6, spread: 2, perkEvery: 20, rivalPace: 92, teamSize: 2 },
  zen: { wordShape: "balanced", intensity: 1, strictness: 1, density: 3, reveal: 1, intervalSec: 8, spread: 1, perkEvery: 25, rivalPace: 85, teamSize: 2 },
  pulse: { wordShape: "compact", intensity: 3, strictness: 3, density: 4, reveal: 1, intervalSec: 6, spread: 2, perkEvery: 20, rivalPace: 92, teamSize: 2 },
  relay: { wordShape: "balanced", intensity: 3, strictness: 3, density: 4, reveal: 1, intervalSec: 6, spread: 2, perkEvery: 20, rivalPace: 92, teamSize: 2 },
  cipher: { wordShape: "balanced", intensity: 3, strictness: 3, density: 4, reveal: 1, intervalSec: 6, spread: 2, perkEvery: 20, rivalPace: 92, teamSize: 2 },
  drift: { wordShape: "balanced", intensity: 3, strictness: 2, density: 4, reveal: 1, intervalSec: 6, spread: 2, perkEvery: 20, rivalPace: 92, teamSize: 2 },
  reverse: { wordShape: "compact", intensity: 3, strictness: 3, density: 4, reveal: 1, intervalSec: 6, spread: 2, perkEvery: 20, rivalPace: 92, teamSize: 2 },
  echo: { wordShape: "balanced", intensity: 3, strictness: 4, density: 4, reveal: 1, intervalSec: 6, spread: 2, perkEvery: 20, rivalPace: 92, teamSize: 2 },
  rogue: { wordShape: "balanced", intensity: 3, strictness: 3, density: 4, reveal: 1, intervalSec: 6, spread: 2, perkEvery: 18, rivalPace: 92, teamSize: 2 },
  duel: { wordShape: "compact", intensity: 4, strictness: 4, density: 4, reveal: 1, intervalSec: 6, spread: 2, perkEvery: 20, rivalPace: 96, teamSize: 2 },
  code: { wordShape: "balanced", intensity: 3, strictness: 4, density: 4, reveal: 1, intervalSec: 6, spread: 2, perkEvery: 20, rivalPace: 92, teamSize: 2 },
  coach: { wordShape: "wild", intensity: 3, strictness: 3, density: 4, reveal: 1, intervalSec: 6, spread: 2, perkEvery: 20, rivalPace: 92, teamSize: 2 },
  blackout: { wordShape: "balanced", intensity: 4, strictness: 4, density: 4, reveal: 1, intervalSec: 6, spread: 2, perkEvery: 20, rivalPace: 92, teamSize: 2 },
  chain: { wordShape: "compact", intensity: 4, strictness: 3, density: 4, reveal: 1, intervalSec: 6, spread: 2, perkEvery: 20, rivalPace: 92, teamSize: 2 },
  gravity: { wordShape: "compact", intensity: 4, strictness: 4, density: 4, reveal: 1, intervalSec: 6, spread: 2, perkEvery: 20, rivalPace: 92, teamSize: 2 },
  coop: { wordShape: "balanced", intensity: 2, strictness: 2, density: 4, reveal: 1, intervalSec: 6, spread: 2, perkEvery: 20, rivalPace: 92, teamSize: 2 },
  infection: { wordShape: "balanced", intensity: 4, strictness: 4, density: 4, reveal: 1, intervalSec: 6, spread: 2, perkEvery: 20, rivalPace: 92, teamSize: 2 },
  stealth: { wordShape: "wide", intensity: 4, strictness: 4, density: 4, reveal: 1, intervalSec: 6, spread: 2, perkEvery: 20, rivalPace: 92, teamSize: 2 },
  chart: { wordShape: "compact", intensity: 5, strictness: 5, density: 4, reveal: 1, intervalSec: 6, spread: 2, perkEvery: 20, rivalPace: 92, teamSize: 2 },
};

interface AccessibilityPrefs {
  announceEvents: boolean;
  textScale: number;
}

interface PrivacyConsent {
  version: number;
  analytics: boolean;
  preferences: boolean;
  decidedAt: string;
}

interface AnalyticsSummaryRow {
  dateKey: string;
  eventName: string;
  page: string | null;
  mode: Mode | null;
  theme: "dark" | "light" | null;
  viewportBucket: "sm" | "md" | "lg" | "xl" | null;
  reducedMotion: boolean | null;
  consentVersion: number | null;
  count: number;
}

interface ReplayEvent {
  t: number;
  key: string;
  kind: "key" | "submit" | "backspace" | "miss" | "mode";
  correct: boolean;
}

interface ReplayRun {
  id: string;
  mode: Mode;
  createdAt: string;
  durationMs: number;
  wpm: number;
  accuracy: number;
  events: ReplayEvent[];
  samples: Array<{ t: number; words: number; chars: number }>;
}

interface GhostRun {
  mode: Mode;
  wpm: number;
  accuracy: number;
  samples: Array<{ t: number; words: number; chars: number }>;
  updatedAt: number;
}

interface RogueBuffs {
  scoreMultiplier: number;
  shieldCharges: number;
  wrongPenaltyScale: number;
  comboBonus: number;
  extraTimeSec: number;
}

interface RogueOffer {
  id: string;
  name: string;
  description: string;
  apply: (buffs: RogueBuffs) => RogueBuffs;
}

interface MeteorWord {
  id: number;
  text: string;
  xPercent: number;
  yPercent: number;
  speed: number;
}

interface SubmittedWordSnapshot {
  index: number;
  typed: string;
  result: "good" | "bad" | undefined;
  correctChars: number;
  wrongChars: number;
  rawChars: number;
  errors: number;
  streak: number;
  maxStreak: number;
  completedWords: number;
  chainCombo: number;
  infectedIndices: number[];
  echoPending: string | null;
}

interface LaserFx {
  id: number;
  xPercent: number;
  yPercent: number;
  lockId: number | null;
}

interface ExplosionFx {
  id: number;
  xPercent: number;
  yPercent: number;
}

interface SessionReport {
  reason: string;
  wpm: number;
  raw: number;
  cpm: number;
  kps: number;
  accuracy: number;
  efficiency: number;
  elapsedSec: number;
  completedWords: number;
  correctChars: number;
  wrongChars: number;
  maxStreak: number;
  best: number;
}

interface LiveStats {
  wpm: number;
  raw: number;
  cpm: number;
  kps: number;
  accuracy: number;
  efficiency: number;
  errors: number;
  streak: number;
  maxStreak: number;
  elapsedSec: number;
  completedWords: number;
  correctChars: number;
  wrongChars: number;
  lives: number;
}

interface RuntimeState {
  status: RuntimeStatus;
  runNonce: number;
  startMs: number;
  finishMs: number;
  correctChars: number;
  wrongChars: number;
  rawChars: number;
  errors: number;
  streak: number;
  maxStreak: number;
  completedWords: number;
  lives: number;
  hudRaf: number;
  lastHudPaint: number;
  meteorRaf: number;
  meteorSpawnClock: number;
  meteorLastTs: number;
  meteorWords: MeteorWord[];
  meteorWordId: number;
  meteorLastPaint: number;
  meteorLockId: number | null;
  meteorBuffer: string;
  sessionId: string | null;
  sessionToken: string | null;
}

interface FocusPrefs {
  enabled: boolean;
  showStats: boolean;
  sfxEnabled: boolean;
  musicEnabled: boolean;
  sfxVolume: number;
  musicVolume: number;
  statVisibility: Record<string, boolean>;
}

const DEFAULT_FOCUS_STAT_VISIBILITY: Record<string, boolean> = {
  wpm: true,
  raw: false,
  cpm: false,
  kps: false,
  acc: true,
  eff: false,
  words: true,
  correct: false,
  wrong: false,
  errors: true,
  streak: true,
  bestStreak: false,
  time: true,
  lives: true,
};

function compareWords(typed: string, target: string) {
  let correct = 0;
  let wrong = 0;
  const maxLen = Math.max(typed.length, target.length);
  for (let i = 0; i < maxLen; i += 1) {
    if (typed[i] === target[i] && typed[i] !== undefined) {
      correct += 1;
    } else {
      wrong += 1;
    }
  }
  return { correct, wrong };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatSeconds(value: number) {
  return `${Math.max(value, 0).toFixed(1)}s`;
}

function meteorDifficulty(runtime: RuntimeState) {
  const elapsedSec =
    runtime.status === "running" && runtime.startMs > 0
      ? Math.max(0, (performance.now() - runtime.startMs) / 1000)
      : 0;

  return {
    elapsedSec,
    // Linear ramp: starts easy, then steadily increases difficulty over time.
    speedScale: clamp(0.48 + elapsedSec * 0.008, 0.48, 1.65),
    spawnIntervalSec: clamp(1.9 - elapsedSec * 0.003, 0.82, 1.9),
  };
}

function pulseTiming(runtime: RuntimeState, bpm: number) {
  const safeBpm = clamp(bpm, 60, 220);
  const beatIntervalSec = 60 / safeBpm;
  if (runtime.status !== "running" || runtime.startMs <= 0) {
    return {
      elapsedSec: 0,
      phase: 0,
      distanceSec: beatIntervalSec,
      quality: "miss" as PulseJudgeTone,
      beatIntervalSec,
    };
  }
  const elapsedSec = Math.max(0, (performance.now() - runtime.startMs) / 1000);
  const phase = (elapsedSec % beatIntervalSec) / beatIntervalSec;
  const distanceSec = Math.min(phase, 1 - phase) * beatIntervalSec;
  let quality: PulseJudgeTone = "miss";
  if (distanceSec <= 0.055) {
    quality = "perfect";
  } else if (distanceSec <= 0.11) {
    quality = "great";
  } else if (distanceSec <= 0.18) {
    quality = "ok";
  }

  return {
    elapsedSec,
    phase,
    distanceSec,
    quality,
    beatIntervalSec,
  };
}

function encodeCipherWord(word: string, shift = 3) {
  return word.replace(/[a-z]/gi, (char) => {
    const base = char >= "a" && char <= "z" ? 97 : 65;
    const code = char.charCodeAt(0) - base;
    const next = ((code + shift) % 26 + 26) % 26;
    return String.fromCharCode(next + base);
  });
}

function maskInnerLetters(word: string): string {
  if (word.length <= 2) {
    return word;
  }
  return `${word[0]}${"•".repeat(word.length - 2)}${word[word.length - 1]}`;
}

function scoreSummary(runtime: RuntimeState) {
  const elapsedSec = Math.max(
    (runtime.finishMs > 0 ? runtime.finishMs : performance.now()) - runtime.startMs,
    16,
  ) / 1000;
  const wpm = (runtime.correctChars / 5 / elapsedSec) * 60;
  const raw = (runtime.rawChars / 5 / elapsedSec) * 60;
  const denominator = runtime.correctChars + runtime.wrongChars;
  const accuracy = denominator > 0 ? (runtime.correctChars / denominator) * 100 : 100;
  return { elapsedSec, wpm, raw, accuracy };
}

function isEditableElement(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable ||
    Boolean(el.closest("input, textarea, select, [contenteditable='true']"))
  );
}

const KEYBOARD_ROWS = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"];

const KEY_TO_FINGER: Record<string, string> = {
  "1": "L Pinky",
  "2": "L Ring",
  "3": "L Middle",
  "4": "L Index",
  "5": "L Index",
  "6": "R Index",
  "7": "R Index",
  "8": "R Middle",
  "9": "R Ring",
  "0": "R Pinky",
  q: "L Pinky",
  w: "L Ring",
  e: "L Middle",
  r: "L Index",
  t: "L Index",
  y: "R Index",
  u: "R Index",
  i: "R Middle",
  o: "R Ring",
  p: "R Pinky",
  a: "L Pinky",
  s: "L Ring",
  d: "L Middle",
  f: "L Index",
  g: "L Index",
  h: "R Index",
  j: "R Index",
  k: "R Middle",
  l: "R Ring",
  z: "L Pinky",
  x: "L Ring",
  c: "L Middle",
  v: "L Index",
  b: "L Index",
  n: "R Index",
  m: "R Index",
};

function simpleHash64(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = `${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
  return `${hex}${hex}${hex}${hex}`.slice(0, 64);
}

function extractWeakPatterns(target: string, typed: string): string[] {
  const patterns: string[] = [];
  const maxLen = Math.min(Math.max(target.length, typed.length), 20);
  for (let i = 0; i < maxLen; i += 1) {
    if (target[i] !== typed[i]) {
      const bi = target.slice(Math.max(0, i - 1), Math.min(target.length, i + 1));
      const tri = target.slice(Math.max(0, i - 1), Math.min(target.length, i + 2));
      if (bi.length === 2) {
        patterns.push(bi.toLowerCase());
      }
      if (tri.length === 3) {
        patterns.push(tri.toLowerCase());
      }
    }
  }
  return patterns;
}

function randomPick<T>(values: T[], count: number): T[] {
  const pool = [...values];
  const out: T[] = [];
  while (pool.length > 0 && out.length < count) {
    const index = Math.floor(Math.random() * pool.length);
    const next = pool[index];
    if (next !== undefined) {
      out.push(next);
    }
    pool.splice(index, 1);
  }
  return out;
}

function generateCoachWords(pool: string[], weakPatterns: string[], count: number): string[] {
  if (weakPatterns.length === 0) {
    return generateWords(pool, count);
  }
  const targetPatterns = weakPatterns.slice(0, 8).map((pattern) => pattern.toLowerCase());
  const focused = pool.filter((word) =>
    targetPatterns.some((pattern) => pattern.length > 1 && word.toLowerCase().includes(pattern)),
  );
  const blend = [...focused, ...pool].filter(Boolean);
  if (blend.length === 0) {
    return [];
  }
  return generateWords(blend, count);
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateSeededWords(pool: string[], count: number, seed: number): string[] {
  if (pool.length === 0 || count <= 0) {
    return [];
  }
  const nextRand = mulberry32(seed);
  const words: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const index = Math.floor(nextRand() * pool.length);
    const value = pool[index];
    if (value !== undefined) {
      words.push(value);
    }
  }
  return words;
}

function buildPromptWindow(
  words: string[],
  currentIndex: number,
  mode: Mode,
  codeLineStarts: Record<number, number>,
): Array<{ word: string; index: number }> {
  if (words.length === 0) {
    return [];
  }
  if (mode === "code" && Object.keys(codeLineStarts).length > 0) {
    const starts = Object.keys(codeLineStarts)
      .map(Number)
      .filter((index) => Number.isFinite(index))
      .sort((a, b) => a - b);
    let activeLine = 0;
    for (let i = 0; i < starts.length; i += 1) {
      const lineStart = starts[i];
      if (lineStart != null && lineStart <= currentIndex) {
        activeLine = i;
      } else {
        break;
      }
    }
    const start = starts[activeLine] ?? currentIndex;
    const end = starts[Math.min(activeLine + 4, starts.length)] ?? Math.min(words.length, start + 90);
    return words.slice(start, end).map((word, offset) => ({ word, index: start + offset }));
  }

  const lineBudget = mode === "quote" ? 64 : 56;
  const lines: Array<Array<{ word: string; index: number }>> = [];
  let line: Array<{ word: string; index: number }> = [];
  let lineLength = 0;
  words.forEach((word, index) => {
    const nextLength = lineLength + word.length + (line.length > 0 ? 1 : 0);
    if (line.length > 0 && nextLength > lineBudget) {
      lines.push(line);
      line = [];
      lineLength = 0;
    }
    line.push({ word, index });
    lineLength += word.length + (line.length > 1 ? 1 : 0);
  });
  if (line.length > 0) {
    lines.push(line);
  }
  const activeLineIndex = Math.max(
    0,
    lines.findIndex((entries) => entries.some((entry) => entry.index === currentIndex)),
  );
  return lines.slice(activeLineIndex, activeLineIndex + 4).flat();
}

interface ModePromptProfile {
  minLength?: number;
  maxLength?: number;
  alphaOnly?: boolean;
  noTrailingPunctuation?: boolean;
}

const MODE_PROMPT_PROFILES: Partial<Record<Mode, ModePromptProfile>> = {
  time: { minLength: 3, maxLength: 9 },
  pulse: { minLength: 2, maxLength: 7, noTrailingPunctuation: true },
  duel: { minLength: 2, maxLength: 7, noTrailingPunctuation: true },
  chart: { minLength: 2, maxLength: 6, noTrailingPunctuation: true },
  relay: { minLength: 3, maxLength: 8 },
  cipher: { minLength: 3, maxLength: 10, alphaOnly: true },
  drift: { minLength: 3, maxLength: 8 },
  reverse: { minLength: 3, maxLength: 8 },
  gravity: { minLength: 3, maxLength: 8 },
  echo: { minLength: 4, maxLength: 9, noTrailingPunctuation: true },
  blackout: { minLength: 4, maxLength: 10, noTrailingPunctuation: true },
  stealth: { minLength: 4, maxLength: 10, noTrailingPunctuation: true },
  rogue: { minLength: 3, maxLength: 9 },
  chain: { minLength: 3, maxLength: 8 },
  coop: { minLength: 3, maxLength: 8 },
  infection: { minLength: 4, maxLength: 8 },
  coach: { minLength: 3, maxLength: 12 },
  meteor: { minLength: 3, maxLength: 8, alphaOnly: true },
};

function baseWordLength(word: string): number {
  return word.replace(/[.,!?;:]+$/g, "").length;
}

function applyModePromptProfile(pool: string[], mode: Mode, tuning: ModeTuning): string[] {
  const profile = MODE_PROMPT_PROFILES[mode];
  if (!profile || pool.length === 0) {
    return pool;
  }
  const shapeBounds: Record<WordShape, { min?: number; max?: number }> = {
    compact: { min: 2, max: 6 },
    balanced: {},
    wide: { min: 6, max: 12 },
    wild: { min: 2, max: 12 },
  };
  const shape = shapeBounds[tuning.wordShape];
  const minLength = shape.min ?? profile.minLength;
  const maxLength = shape.max ?? profile.maxLength;
  const filtered = pool.filter((word) => {
    const clean = word.replace(/[.,!?;:]+$/g, "");
    const length = baseWordLength(word);
    if (profile.alphaOnly && !/^[a-z]+$/i.test(clean)) return false;
    if (profile.noTrailingPunctuation && clean !== word) return false;
    if (minLength != null && length < minLength) return false;
    if (maxLength != null && length > maxLength) return false;
    return true;
  });
  const minimumUsefulPool = Math.max(12, Math.min(80, Math.floor(pool.length * 0.2)));
  return filtered.length >= minimumUsefulPool ? filtered : pool;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export default function App() {
  const router = useRouter();
  const pathname = usePathname();
  const isDevEnvironment = process.env.NODE_ENV !== "production";
  const liveSocialEnabled = process.env.NEXT_PUBLIC_SOCIAL_LIVE_ENABLED !== "false";
  const cloudflareOnly = process.env.NEXT_PUBLIC_CLOUDFLARE_ONLY === "true";
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  const socialLaunchNote =
    "Live social systems are disabled by NEXT_PUBLIC_SOCIAL_LIVE_ENABLED for this environment.";
  const arenaRef = useRef<HTMLElement | null>(null);
  const previewRafRef = useRef(0);
  const replayImportInputRef = useRef<HTMLInputElement | null>(null);
  const pendingPreviewRef = useRef("");
  const typedRef = useRef("");
  const submittedHistoryRef = useRef<SubmittedWordSnapshot[]>([]);
  const wordQueueRef = useRef<string[]>([]);
  const promptWordsRef = useRef<string[]>([]);
  const currentIndexRef = useRef(0);
  const fxIdRef = useRef(0);
  const fxTimeoutsRef = useRef<number[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const musicLoopRef = useRef<number>(0);
  const musicStepRef = useRef(0);
  const adaptiveMusicRef = useRef({ wpm: 0, accuracy: 100, streak: 0, bpm: 84 });
  const pulseJudgeTimeoutRef = useRef(0);
  const runSamplesRef = useRef<Array<{ t: number; words: number; chars: number }>>([]);
  const keyEventsRef = useRef<ReplayEvent[]>([]);
  const keyIntervalsRef = useRef<number[]>([]);
  const lastKeyTsRef = useRef(0);
  const racePushAtRef = useRef(0);
  const echoPendingRef = useRef<string | null>(null);
  const rogueBuffsRef = useRef<RogueBuffs>({
    scoreMultiplier: 1,
    shieldCharges: 0,
    wrongPenaltyScale: 1,
    comboBonus: 0,
    extraTimeSec: 0,
  });

  const runtimeRef = useRef<RuntimeState>({
    status: "idle",
    runNonce: 0,
    startMs: 0,
    finishMs: 0,
    correctChars: 0,
    wrongChars: 0,
    rawChars: 0,
    errors: 0,
    streak: 0,
    maxStreak: 0,
    completedWords: 0,
    lives: 5,
    hudRaf: 0,
    lastHudPaint: 0,
    meteorRaf: 0,
    meteorSpawnClock: 0,
    meteorLastTs: 0,
    meteorWords: [],
    meteorWordId: 0,
    meteorLastPaint: 0,
    meteorLockId: null,
    meteorBuffer: "",
    sessionId: null,
    sessionToken: null,
  });

  const [mode, setMode] = useState<Mode>(() => modeFromPathname(pathname || "/") ?? "time");
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      const consent = readStoredPrivacyConsent();
      if (!consent?.preferences) {
        return "dark";
      }
      const stored = localStorage.getItem(STORAGE_THEME);
      return stored === "light" ? "light" : "dark";
    } catch (_error) {
      return "dark";
    }
  });
  const [appRoute, setAppRoute] = useState<AppRoute>(() => routeFromPathname(pathname || "/"));
  const [accessibilityPrefs, setAccessibilityPrefs] = useState<AccessibilityPrefs>(() => ({
    announceEvents: true,
    textScale: 1,
  }));
  const [durationSec, setDurationSec] = useState(60);
  const [dictionaryPack, setDictionaryPack] = useState<DictionaryPack>("core");
  const [username, setUsername] = useState("player");
  const [phase, setPhase] = useState("Ready");
  const [isRunning, setIsRunning] = useState(false);
  const [timerText, setTimerText] = useState("60.0s");
  const [typedPreview, setTypedPreview] = useState("");
  const [promptWords, setPromptWords] = useState<string[]>([]);
  const [wordResults, setWordResults] = useState<Array<"good" | "bad" | undefined>>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [customInput, setCustomInput] = useState("");
  const [customWords, setCustomWords] = useState<string[]>([]);
  const [largeWords, setLargeWords] = useState<string[]>([]);
  const [frequencyWords, setFrequencyWords] = useState<string[]>([]);
  const [dictionaryStatus, setDictionaryStatus] = useState("Loading word list...");
  const [report, setReport] = useState<SessionReport | null>(null);
  const [stats, setStats] = useState<LiveStats>({
    wpm: 0,
    raw: 0,
    cpm: 0,
    kps: 0,
    accuracy: 100,
    efficiency: 100,
    errors: 0,
    streak: 0,
    maxStreak: 0,
    elapsedSec: 0,
    completedWords: 0,
    correctChars: 0,
    wrongChars: 0,
    lives: 5,
  });
  const [bestByMode, setBestByMode] = useState<Record<Mode, number>>({
    time: 0,
    quote: 0,
    meteor: 0,
    zen: 0,
    pulse: 0,
    relay: 0,
    cipher: 0,
    drift: 0,
    reverse: 0,
    echo: 0,
    rogue: 0,
    duel: 0,
    code: 0,
    coach: 0,
    blackout: 0,
    chain: 0,
    gravity: 0,
    coop: 0,
    infection: 0,
    stealth: 0,
    chart: 0,
  });
  const [focusPrefs, setFocusPrefs] = useState<FocusPrefs>({
    enabled: true,
    showStats: true,
    sfxEnabled: true,
    musicEnabled: true,
    sfxVolume: 0.78,
    musicVolume: 0.42,
    statVisibility: DEFAULT_FOCUS_STAT_VISIBILITY,
  });
  const [cipherShift, setCipherShift] = useState(3);
  const [cipherDirection, setCipherDirection] = useState<CipherDirection>("forward");
  const [codeLanguage, setCodeLanguage] = useState<CodeLanguage>("typescript");
  const [codeIndentMode, setCodeIndentMode] = useState<CodeIndentMode>("preserve");
  const [codeLineStarts, setCodeLineStarts] = useState<Record<number, number>>({});
  const [modeTuning, setModeTuning] = useState<Record<Mode, ModeTuning>>(DEFAULT_MODE_TUNING);
  const [pulseBpm, setPulseBpm] = useState(108);
  const [pulseJudge, setPulseJudge] = useState<{ label: string; tone: PulseJudgeTone } | null>(null);
  const [soundPack, setSoundPack] = useState<SoundPack>("arcade");
  const [accessibilityPreset, setAccessibilityPreset] = useState<AccessibilityPreset>("standard");
  const [adaptiveTrainer, setAdaptiveTrainer] = useState(false);
  const [weaknessMap, setWeaknessMap] = useState<Record<string, number>>({});
  const [keyStats, setKeyStats] = useState<Record<string, { hits: number; errors: number }>>({});
  const [ghostRuns, setGhostRuns] = useState<Partial<Record<Mode, GhostRun>>>({});
  const [ghostStatus, setGhostStatus] = useState("No ghost");
  const [replays, setReplays] = useState<ReplayRun[]>([]);
  const [selectedReplayId, setSelectedReplayId] = useState<string>("");
  const [replayCursorMs, setReplayCursorMs] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayNote, setReplayNote] = useState<string | null>(null);
  const [raceName, setRaceName] = useState("Pilot");
  const [raceRoomInput, setRaceRoomInput] = useState("");
  const [raceRoomId, setRaceRoomId] = useState("");
  const [racePlayerId, setRacePlayerId] = useState("");
  const [raceState, setRaceState] = useState<RaceRoomState | null>(null);
  const [raceError, setRaceError] = useState<string | null>(null);
  const [tournamentName, setTournamentName] = useState("Orbital Cup");
  const [tournamentEntrantsInput, setTournamentEntrantsInput] = useState("alpha\nbeta\ngamma\ndelta");
  const [tournamentLookupId, setTournamentLookupId] = useState("");
  const [tournamentState, setTournamentState] = useState<TournamentState | null>(null);
  const [tournamentError, setTournamentError] = useState<string | null>(null);
  const [echoPending, setEchoPending] = useState<string | null>(null);
  const [rogueOffer, setRogueOffer] = useState<RogueOffer[] | null>(null);
  const [rogueBuffLabel, setRogueBuffLabel] = useState("No perks yet");
  const [duelRivalProgress, setDuelRivalProgress] = useState(0);
  const [meteorWordsView, setMeteorWordsView] = useState<MeteorWord[]>([]);
  const [meteorSelection, setMeteorSelection] = useState<{ id: number | null; typed: string }>({
    id: null,
    typed: "",
  });
  const [laserFx, setLaserFx] = useState<LaserFx[]>([]);
  const [explosionFx, setExplosionFx] = useState<ExplosionFx[]>([]);
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [dailyChallenge, setDailyChallenge] = useState<DailyChallenge | null>(null);
  const [challengeActive, setChallengeActive] = useState(false);
  const [challengeBoard, setChallengeBoard] = useState<ChallengeLeaderboardEntry[]>([]);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [challengeNote, setChallengeNote] = useState<string | null>(null);
  const [seasonWindow, setSeasonWindow] = useState<SeasonWindow | null>(null);
  const [seasonBoard, setSeasonBoard] = useState<SeasonLeaderboardEntry[]>([]);
  const [seasonError, setSeasonError] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const [liveAlertMessage, setLiveAlertMessage] = useState("");
  const [chainCombo, setChainCombo] = useState(1);
  const [coopTurn, setCoopTurn] = useState(1);

  function clearRaceSession(message?: string) {
    setRaceRoomId("");
    setRaceRoomInput("");
    setRacePlayerId("");
    setRaceState(null);
    setRaceError(message ?? null);
    try {
      localStorage.removeItem(STORAGE_RACE_META);
    } catch (_error) {
      // ignore storage write failures
    }
  }
  const [infectedIndices, setInfectedIndices] = useState<number[]>([]);
  const [certifiedRun, setCertifiedRun] = useState(false);
  const [modePreview, setModePreview] = useState<Mode | null>(null);
  const [privacyConsent, setPrivacyConsent] = useState<PrivacyConsent | null>(null);
  const [consentDraft, setConsentDraft] = useState({ analytics: false, preferences: false });
  const [privacyNote, setPrivacyNote] = useState<string | null>(null);
  const [analyticsAdminToken, setAnalyticsAdminToken] = useState("");
  const [botSeedToken, setBotSeedToken] = useState("");
  const [analyticsSummaryRows, setAnalyticsSummaryRows] = useState<AnalyticsSummaryRow[]>([]);
  const [analyticsSummaryTotals, setAnalyticsSummaryTotals] = useState<Record<string, number>>({});
  const [analyticsSummaryLoading, setAnalyticsSummaryLoading] = useState(false);
  const [analyticsSummaryError, setAnalyticsSummaryError] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const [accountToken, setAccountToken] = useState<string>("");
  const [accountProfile, setAccountProfile] = useState<AccountProfile | null>(null);
  const [accountPrefs, setAccountPrefs] = useState<Record<string, unknown>>({});
  const [authHandle, setAuthHandle] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authNewPassword, setAuthNewPassword] = useState("");
  const [authLocale, setAuthLocale] = useState("en");
  const [authTurnstileToken, setAuthTurnstileToken] = useState("");
  const [authTurnstileResetKey, setAuthTurnstileResetKey] = useState(0);
  const [authNote, setAuthNote] = useState<string | null>(null);
  const [accountSessions, setAccountSessions] = useState<AccountSessionEntry[]>([]);
  const [accountSessionId, setAccountSessionId] = useState("");
  const [deleteHandleConfirm, setDeleteHandleConfirm] = useState("");
  const [accountLifecycleNote, setAccountLifecycleNote] = useState<string | null>(null);
  const [friendHandle, setFriendHandle] = useState("");
  const [friends, setFriends] = useState<FriendListResponse>({
    friends: [],
    incoming: [],
    outgoing: [],
  });
  const [rankedStatus, setRankedStatus] = useState<string>("idle");
  const [activeDuel, setActiveDuel] = useState<DuelState | null>(null);
  const [duelNote, setDuelNote] = useState<string | null>(null);
  const [duelQueueAction, setDuelQueueAction] = useState<"ranked" | "casual" | "status" | null>(null);
  const [replayShareTitle, setReplayShareTitle] = useState("My run");
  const [sharedReplayIdInput, setSharedReplayIdInput] = useState("");
  const [replayShares, setReplayShares] = useState<ReplayShareEntry[]>([]);
  const [loadedSharedReplay, setLoadedSharedReplay] = useState<ReplayShareEntry | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvents, setWebhookEvents] = useState("score.submitted");
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [webhookNote, setWebhookNote] = useState<string | null>(null);
  const [adminUserQuery, setAdminUserQuery] = useState("");
  const [adminUsers, setAdminUsers] = useState<AdminUserEntry[]>([]);
  const [adminLeaderboardQuery, setAdminLeaderboardQuery] = useState("");
  const [adminLeaderboardRows, setAdminLeaderboardRows] = useState<AdminLeaderboardEntry[]>([]);
  const [adminNote, setAdminNote] = useState<string | null>(null);

  const [settings, setSettings] = useState({
    punctuation: false,
    numbers: false,
    lowercase: false,
    customOnly: false,
  });
  const doNotTrackEnabled = useMemo(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    const nav = navigator as Navigator & { msDoNotTrack?: string };
    const win = window as Window & { doNotTrack?: string; globalPrivacyControl?: boolean };
    return (
      nav.doNotTrack === "1" ||
      nav.doNotTrack === "yes" ||
      nav.msDoNotTrack === "1" ||
      win.doNotTrack === "1" ||
      win.globalPrivacyControl === true
    );
  }, []);
  const analyticsEnabled = privacyConsent?.analytics === true;
  const canStoreComfortPrefs = privacyConsent?.preferences === true;
  const isAnalyticsAdmin = Boolean(
    accountProfile && ADMIN_HANDLES.has(accountProfile.handle.trim().toLowerCase()),
  );
  const clientViewportBucket =
    typeof window !== "undefined" ? viewportBucket(window.innerWidth) : ("lg" as const);
  const localProfileSummary = useMemo(() => {
    const bestEntry = (Object.entries(bestByMode) as Array<[Mode, number]>).reduce<{
      mode: Mode;
      wpm: number;
    } | null>((best, [modeId, value]) => {
      if (!best || value > best.wpm) {
        return { mode: modeId, wpm: value };
      }
      return best;
    }, null);
    const avgWpm =
      replays.length > 0 ? replays.reduce((sum, replay) => sum + replay.wpm, 0) / replays.length : 0;
    const totalReplayEvents = replays.reduce((sum, replay) => sum + replay.events.length, 0);
    return {
      runs: replays.length,
      avgWpm,
      bestMode: bestEntry?.mode ?? mode,
      bestWpm: bestEntry?.wpm ?? bestByMode[mode] ?? 0,
      ghosts: Object.keys(ghostRuns).length,
      replayEvents: totalReplayEvents,
    };
  }, [bestByMode, ghostRuns, mode, replays]);

  const activePool = useMemo(
    () =>
      buildDictionaryPool({
        pack: dictionaryPack,
        customOnly: settings.customOnly,
        customWords,
        largeWords,
        frequencyWords,
        punctuation: settings.punctuation,
        numbers: settings.numbers,
        lowercase: settings.lowercase,
      }),
    [dictionaryPack, settings, customWords, largeWords, frequencyWords],
  );
  const dictionaryQaRows = useMemo(
    () =>
      DICTIONARY_QA_PACKS.map((pack) => {
        const pool = buildDictionaryPool({
          pack,
          customOnly: false,
          customWords: [],
          largeWords,
          frequencyWords,
          punctuation: false,
          numbers: false,
          lowercase: true,
        });
        return {
          pack,
          count: pool.length,
          sample: pool.slice(0, 18),
        };
      }),
    [largeWords, frequencyWords],
  );
  const weakPatterns = useMemo(
    () =>
      Object.entries(weaknessMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([pattern]) => pattern),
    [weaknessMap],
  );
  const adaptivePool = useMemo(() => {
    if (!adaptiveTrainer || weakPatterns.length === 0 || activePool.length < 100) {
      return activePool;
    }
    const focused = activePool.filter((word) =>
      weakPatterns.some((pattern) => pattern.length > 1 && word.toLowerCase().includes(pattern)),
    );
    if (focused.length >= 220) {
      return [...focused, ...activePool.slice(0, 320)];
    }
    return activePool;
  }, [activePool, adaptiveTrainer, weakPatterns]);
  const activeModeTuning = modeTuning[mode] ?? DEFAULT_MODE_TUNING[mode];
  const playPool = useMemo(
    () => applyModePromptProfile(adaptivePool, mode, activeModeTuning),
    [activeModeTuning, adaptivePool, mode],
  );

  const activeWords = promptWords;

  const visibleWords = useMemo(() => {
    const entries = buildPromptWindow(activeWords, currentIndex, mode, codeLineStarts);
    if (mode === "reverse") {
      entries.reverse();
    }
    return entries;
  }, [activeWords, codeLineStarts, currentIndex, mode]);

  useEffect(() => {
    try {
      const storedConsent = readStoredPrivacyConsent();
      const allowStoredComfortPrefs = storedConsent?.preferences === true;
      const storedCustom = localStorage.getItem(STORAGE_CUSTOM);
      if (storedCustom) {
        const parsed = JSON.parse(storedCustom) as string[];
        if (Array.isArray(parsed)) {
          setCustomWords(parsed);
          setCustomInput(parsed.join("\n"));
        }
      }
      const storedBest = localStorage.getItem(STORAGE_BEST);
      if (storedBest) {
        const parsed = JSON.parse(storedBest) as Partial<Record<Mode, number>>;
        if (parsed) {
          setBestByMode({
            time: parsed.time ?? 0,
            quote: parsed.quote ?? 0,
            meteor: parsed.meteor ?? 0,
            zen: parsed.zen ?? 0,
            pulse: parsed.pulse ?? 0,
            relay: parsed.relay ?? 0,
            cipher: parsed.cipher ?? 0,
            drift: parsed.drift ?? 0,
            reverse: parsed.reverse ?? 0,
            echo: parsed.echo ?? 0,
            rogue: parsed.rogue ?? 0,
            duel: parsed.duel ?? 0,
            code: parsed.code ?? 0,
            coach: parsed.coach ?? 0,
            blackout: parsed.blackout ?? 0,
            chain: parsed.chain ?? 0,
            gravity: parsed.gravity ?? 0,
            coop: parsed.coop ?? 0,
            infection: parsed.infection ?? 0,
            stealth: parsed.stealth ?? 0,
            chart: parsed.chart ?? 0,
          });
        }
      }
      if (allowStoredComfortPrefs) {
        const storedFocus = localStorage.getItem(STORAGE_FOCUS_PREFS);
        if (storedFocus) {
          const parsed = JSON.parse(storedFocus) as Partial<FocusPrefs>;
          if (parsed) {
            setFocusPrefs({
              enabled: parsed.enabled ?? true,
              showStats: parsed.showStats ?? true,
              sfxEnabled: parsed.sfxEnabled ?? true,
              musicEnabled: parsed.musicEnabled ?? true,
              sfxVolume: clamp(Number(parsed.sfxVolume ?? 0.78), 0, 1),
              musicVolume: clamp(Number(parsed.musicVolume ?? 0.42), 0, 1),
              statVisibility: {
                ...DEFAULT_FOCUS_STAT_VISIBILITY,
                ...(parsed.statVisibility ?? {}),
              },
            });
          }
        }
        const storedCipher = localStorage.getItem(STORAGE_CIPHER_PREFS);
        if (storedCipher) {
          const parsed = JSON.parse(storedCipher) as
            | Partial<{
                shift: number;
                direction: CipherDirection;
              }>
            | null;
          if (parsed) {
            setCipherShift(clamp(Math.round(parsed.shift ?? 3), 1, 25));
            setCipherDirection(parsed.direction === "backward" ? "backward" : "forward");
          }
        }
        const storedPulse = localStorage.getItem(STORAGE_PULSE_PREFS);
        if (storedPulse) {
          const parsed = JSON.parse(storedPulse) as Partial<{ bpm: number }> | null;
          if (parsed) {
            setPulseBpm(clamp(Math.round(parsed.bpm ?? 108), 60, 220));
          }
        }
        const storedSoundPack = localStorage.getItem(STORAGE_SOUND_PACK);
        if (
          storedSoundPack === "arcade" ||
          storedSoundPack === "retro" ||
          storedSoundPack === "cinematic" ||
          storedSoundPack === "soft" ||
          storedSoundPack === "mute"
        ) {
          setSoundPack(storedSoundPack);
        }
        const storedAccessibility = localStorage.getItem(STORAGE_ACCESSIBILITY);
        if (
          storedAccessibility === "standard" ||
          storedAccessibility === "reduced" ||
          storedAccessibility === "contrast" ||
          storedAccessibility === "colorblind" ||
          storedAccessibility === "dyslexia"
        ) {
          setAccessibilityPreset(storedAccessibility);
        } else {
          if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
            setAccessibilityPreset("reduced");
          } else if (window.matchMedia?.("(prefers-contrast: more)")?.matches) {
            setAccessibilityPreset("contrast");
          }
        }
        const storedA11yPrefs = localStorage.getItem(STORAGE_A11Y_PREFS);
        if (storedA11yPrefs) {
          const parsed = JSON.parse(storedA11yPrefs) as Partial<AccessibilityPrefs> | null;
          if (parsed) {
            setAccessibilityPrefs({
              announceEvents: parsed.announceEvents ?? true,
              textScale: clamp(Number(parsed.textScale ?? 1), 0.85, 1.25),
            });
          }
        }
      } else {
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
          setAccessibilityPreset("reduced");
        } else if (window.matchMedia?.("(prefers-contrast: more)")?.matches) {
          setAccessibilityPreset("contrast");
        }
      }
      const storedWeakness = localStorage.getItem(STORAGE_WEAKNESS_MAP);
      if (storedWeakness) {
        const parsed = JSON.parse(storedWeakness) as Record<string, number>;
        if (parsed && typeof parsed === "object") {
          setWeaknessMap(parsed);
        }
      }
      const storedKeyStats = localStorage.getItem(STORAGE_KEY_STATS);
      if (storedKeyStats) {
        const parsed = JSON.parse(storedKeyStats) as Record<string, { hits: number; errors: number }>;
        if (parsed && typeof parsed === "object") {
          setKeyStats(parsed);
        }
      }
      const storedGhosts = localStorage.getItem(STORAGE_GHOSTS);
      if (storedGhosts) {
        const parsed = JSON.parse(storedGhosts) as Partial<Record<Mode, GhostRun>>;
        if (parsed && typeof parsed === "object") {
          setGhostRuns(parsed);
        }
      }
      const storedReplays = localStorage.getItem(STORAGE_REPLAYS);
      if (storedReplays) {
        const parsed = JSON.parse(storedReplays) as ReplayRun[];
        if (Array.isArray(parsed)) {
          const clipped = parsed.slice(0, 20);
          setReplays(clipped);
          if (clipped[0]) {
            setSelectedReplayId(clipped[0].id);
          }
        }
      }
      const storedRaceMeta = localStorage.getItem(STORAGE_RACE_META);
      if (storedRaceMeta) {
        const parsed = JSON.parse(storedRaceMeta) as
          | Partial<{ raceName: string; roomId: string; playerId: string }>
          | null;
        if (parsed) {
          setRaceName(parsed.raceName?.slice(0, 24) || "Pilot");
          setRaceRoomId(parsed.roomId?.toUpperCase() || "");
          setRaceRoomInput(parsed.roomId?.toUpperCase() || "");
          setRacePlayerId(parsed.playerId || "");
        }
      }
      const storedAccountToken = localStorage.getItem(STORAGE_ACCOUNT_TOKEN);
      if (storedAccountToken) {
        setAccountToken(storedAccountToken);
      }
      const storedAccountProfile = localStorage.getItem(STORAGE_ACCOUNT_PROFILE);
      if (storedAccountProfile) {
        const parsed = JSON.parse(storedAccountProfile) as AccountProfile;
        if (parsed && typeof parsed === "object" && typeof parsed.id === "string") {
          setAccountProfile(parsed);
          setAuthHandle(parsed.handle);
          setUsername(parsed.handle);
        }
      }
      const storedAccountPrefs = localStorage.getItem(STORAGE_ACCOUNT_PREFS);
      if (storedAccountPrefs) {
        const parsed = JSON.parse(storedAccountPrefs) as Record<string, unknown>;
        if (parsed && typeof parsed === "object") {
          setAccountPrefs(parsed);
        }
      }
      if (storedConsent) {
        setPrivacyConsent(storedConsent);
        setConsentDraft({
          analytics: storedConsent.analytics,
          preferences: storedConsent.preferences,
        });
      }
    } catch (_error) {
      // ignore malformed storage
    }
  }, []);

  useEffect(() => {
    const currentPath = pathname || "/";
    setAppRoute(routeFromPathname(currentPath));
    const routeMode = modeFromPathname(currentPath);
    if (routeMode) {
      setMode(routeMode);
      setModePreview(routeMode);
    }
  }, [pathname]);

  useEffect(() => {
    installOfflineSyncHooks();
    void flushQueuedScores();

    if (!("serviceWorker" in navigator)) {
      return;
    }
    if (isDevEnvironment) {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          void registration.unregister();
        }
      });
      if ("caches" in window) {
        void caches.keys().then((keys) => {
          for (const key of keys) {
            if (key.startsWith("typeshift-cache")) {
              void caches.delete(key);
            }
          }
        });
      }
      return;
    }
    const register = () => {
      void navigator.serviceWorker.register("/sw.js");
    };
    window.addEventListener("load", register);
    return () => {
      window.removeEventListener("load", register);
    };
  }, [isDevEnvironment]);

  useEffect(() => {
    if (!privacyConsent) {
      return;
    }
    try {
      localStorage.setItem(STORAGE_PRIVACY_CONSENT, JSON.stringify(privacyConsent));
    } catch (_error) {
      // ignore storage write failures
    }
  }, [privacyConsent]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      if (canStoreComfortPrefs) {
        localStorage.setItem(STORAGE_THEME, theme);
      } else {
        localStorage.removeItem(STORAGE_THEME);
      }
    } catch (_error) {
      // ignore storage write failures
    }
  }, [canStoreComfortPrefs, theme]);

  useEffect(() => {
    setAccountPrefs((prev) => {
      const next: Record<string, unknown> = { ...prev, privacyConsent };
      if (canStoreComfortPrefs) {
        return {
          ...next,
          theme,
          mode,
          durationSec,
          dictionaryPack,
          soundPack,
          accessibilityPreset,
          textScale: accessibilityPrefs.textScale,
          focusPrefs,
        };
      }
      delete next.theme;
      delete next.mode;
      delete next.durationSec;
      delete next.dictionaryPack;
      delete next.soundPack;
      delete next.accessibilityPreset;
      delete next.textScale;
      delete next.focusPrefs;
      return next;
    });
  }, [
    accessibilityPrefs.textScale,
    accessibilityPreset,
    canStoreComfortPrefs,
    dictionaryPack,
    durationSec,
    focusPrefs,
    mode,
    privacyConsent,
    soundPack,
    theme,
  ]);

  useEffect(() => {
    try {
      if (canStoreComfortPrefs) {
        localStorage.setItem(STORAGE_FOCUS_PREFS, JSON.stringify(focusPrefs));
      } else {
        localStorage.removeItem(STORAGE_FOCUS_PREFS);
      }
    } catch (_error) {
      // ignore storage write failures
    }
  }, [canStoreComfortPrefs, focusPrefs]);

  useEffect(() => {
    try {
      if (canStoreComfortPrefs) {
        localStorage.setItem(
          STORAGE_CIPHER_PREFS,
          JSON.stringify({ shift: cipherShift, direction: cipherDirection }),
        );
      } else {
        localStorage.removeItem(STORAGE_CIPHER_PREFS);
      }
    } catch (_error) {
      // ignore storage write failures
    }
  }, [canStoreComfortPrefs, cipherShift, cipherDirection]);

  useEffect(() => {
    try {
      if (canStoreComfortPrefs) {
        localStorage.setItem(STORAGE_PULSE_PREFS, JSON.stringify({ bpm: pulseBpm }));
      } else {
        localStorage.removeItem(STORAGE_PULSE_PREFS);
      }
    } catch (_error) {
      // ignore storage write failures
    }
  }, [canStoreComfortPrefs, pulseBpm]);

  useEffect(() => {
    document.documentElement.setAttribute("data-accessibility", accessibilityPreset);
    try {
      if (canStoreComfortPrefs) {
        localStorage.setItem(STORAGE_ACCESSIBILITY, accessibilityPreset);
      } else {
        localStorage.removeItem(STORAGE_ACCESSIBILITY);
      }
    } catch (_error) {
      // ignore storage write failures
    }
  }, [accessibilityPreset, canStoreComfortPrefs]);

  useEffect(() => {
    document.documentElement.style.setProperty("--text-scale", String(accessibilityPrefs.textScale));
    try {
      if (canStoreComfortPrefs) {
        localStorage.setItem(STORAGE_A11Y_PREFS, JSON.stringify(accessibilityPrefs));
      } else {
        localStorage.removeItem(STORAGE_A11Y_PREFS);
      }
    } catch (_error) {
      // ignore storage write failures
    }
  }, [accessibilityPrefs, canStoreComfortPrefs]);

  useEffect(() => {
    try {
      if (canStoreComfortPrefs) {
        localStorage.setItem(STORAGE_SOUND_PACK, soundPack);
      } else {
        localStorage.removeItem(STORAGE_SOUND_PACK);
      }
    } catch (_error) {
      // ignore storage write failures
    }
  }, [canStoreComfortPrefs, soundPack]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_WEAKNESS_MAP, JSON.stringify(weaknessMap));
    } catch (_error) {
      // ignore storage write failures
    }
  }, [weaknessMap]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(keyStats));
    } catch (_error) {
      // ignore storage write failures
    }
  }, [keyStats]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_GHOSTS, JSON.stringify(ghostRuns));
    } catch (_error) {
      // ignore storage write failures
    }
  }, [ghostRuns]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_REPLAYS, JSON.stringify(replays.slice(0, 20)));
    } catch (_error) {
      // ignore storage write failures
    }
  }, [replays]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_RACE_META,
        JSON.stringify({ raceName, roomId: raceRoomId, playerId: racePlayerId }),
      );
    } catch (_error) {
      // ignore storage write failures
    }
  }, [raceName, raceRoomId, racePlayerId]);

  useEffect(() => {
    try {
      if (accountToken) {
        localStorage.setItem(STORAGE_ACCOUNT_TOKEN, accountToken);
      } else {
        localStorage.removeItem(STORAGE_ACCOUNT_TOKEN);
      }
    } catch (_error) {
      // ignore storage write failures
    }
  }, [accountToken]);

  useEffect(() => {
    try {
      if (accountProfile) {
        localStorage.setItem(STORAGE_ACCOUNT_PROFILE, JSON.stringify(accountProfile));
      } else {
        localStorage.removeItem(STORAGE_ACCOUNT_PROFILE);
      }
    } catch (_error) {
      // ignore storage write failures
    }
  }, [accountProfile]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_ACCOUNT_PREFS, JSON.stringify(accountPrefs));
    } catch (_error) {
      // ignore storage write failures
    }
  }, [accountPrefs]);

  useEffect(() => {
    void flushQueuedScores();
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([loadLargeDictionary(), loadFrequencyDictionary()])
      .then(([wordsResult, rankedWordsResult]) => {
        if (cancelled) return;
        const words = wordsResult.status === "fulfilled" ? wordsResult.value : [];
        const rankedWords = rankedWordsResult.status === "fulfilled" ? rankedWordsResult.value : [];
        setLargeWords(words);
        setFrequencyWords(rankedWords);
        if (words.length > 0 || rankedWords.length > 0) {
          setDictionaryStatus(
            `Dictionary loaded: ${
              rankedWords.length > 0 ? rankedWords.length.toLocaleString() : "ranked fallback"
            } ranked + ${words.length > 0 ? words.length.toLocaleString() : "source fallback"} source words`,
          );
        } else {
          setDictionaryStatus("Using built-in word packs.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function primeWordQueue(target = 1800) {
    if (playPool.length === 0) return;
    const missing = target - wordQueueRef.current.length;
    if (missing > 0) {
      wordQueueRef.current.push(...generateWords(playPool, missing + 700));
    }
  }

  function takeWords(count: number): string[] {
    primeWordQueue(count);
    const out = wordQueueRef.current.splice(0, count);
    if (out.length < count) {
      out.push(...generateWords(playPool, count - out.length));
    }
    primeWordQueue(1800);
    return out;
  }

  function setStructuredCodePrompt(count = 220): void {
    const prompt = generateCodePrompt(codeLanguage, codeIndentMode, count);
    promptWordsRef.current = prompt.tokens;
    setPromptWords(prompt.tokens);
    setCodeLineStarts(prompt.lineStarts);
  }

  function appendStructuredCodePrompt(prev: string[], count = 80): string[] {
    const prompt = generateCodePrompt(codeLanguage, codeIndentMode, count);
    const offset = prev.length;
    setCodeLineStarts((current) => {
      const shifted = Object.fromEntries(
        Object.entries(prompt.lineStarts).map(([index, indent]) => [String(Number(index) + offset), indent]),
      ) as Record<number, number>;
      return { ...current, ...shifted };
    });
    return [...prev, ...prompt.tokens];
  }

  useEffect(() => {
    wordQueueRef.current = [];
    primeWordQueue();
    const warmTimer = window.setTimeout(() => {
      primeWordQueue(3200);
    }, 120);
    return () => {
      window.clearTimeout(warmTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playPool, adaptiveTrainer]);

  useEffect(() => {
    if (mode === "code") {
      resetSession(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeLanguage, codeIndentMode]);

  useEffect(() => {
    resetSession(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, durationSec, playPool, adaptiveTrainer]);

  useEffect(
    () => () => {
      clearLoops();
      for (const timeoutId of fxTimeoutsRef.current) {
        window.clearTimeout(timeoutId);
      }
      fxTimeoutsRef.current = [];
      if (pulseJudgeTimeoutRef.current) {
        window.clearTimeout(pulseJudgeTimeoutRef.current);
        pulseJudgeTimeoutRef.current = 0;
      }
    },
    [],
  );

  useEffect(() => {
    promptWordsRef.current = promptWords;
  }, [promptWords]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  function announce(message: string, assertive = false) {
    if (!accessibilityPrefs.announceEvents) {
      return;
    }
    if (assertive) {
      setLiveAlertMessage("");
      window.setTimeout(() => setLiveAlertMessage(message), 5);
      return;
    }
    setLiveMessage("");
    window.setTimeout(() => setLiveMessage(message), 5);
  }

  function trackPrivacyEvent(
    event:
      | "page_view"
      | "mode_select"
      | "run_start"
      | "run_finish"
      | "auth_register"
      | "auth_login"
      | "consent_update",
    options?: {
      page?: string;
      mode?: Mode;
    },
  ): void {
    if (!analyticsEnabled) {
      return;
    }
    sendPrivacyAnalytics({
      event,
      page: options?.page ?? appRoute,
      ...(options?.mode ? { mode: options.mode } : {}),
      theme,
      consentVersion: PRIVACY_CONSENT_VERSION,
      telemetry: {
        viewportBucket: clientViewportBucket,
        reducedMotion:
          accessibilityPreset === "reduced" || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
        doNotTrack: doNotTrackEnabled,
      },
    });
  }

  function applyPrivacyConsent(next: { analytics: boolean; preferences: boolean }): void {
    const resolved: PrivacyConsent = {
      version: PRIVACY_CONSENT_VERSION,
      analytics: next.analytics,
      preferences: next.preferences,
      decidedAt: new Date().toISOString(),
    };
    setPrivacyConsent(resolved);
    setConsentDraft({
      analytics: resolved.analytics,
      preferences: resolved.preferences,
    });
    setPrivacyNote(
      resolved.analytics
        ? "Anonymous usage stats are on. No tracking cookies are used."
        : "Only essential app behavior is active. Anonymous usage stats stay off.",
    );
    if (accountToken) {
      const nextPrefs = {
        ...accountPrefs,
        privacyConsent: resolved,
      };
      setAccountPrefs(nextPrefs);
      void updateAccountPreferences(accountToken, nextPrefs).catch(() => {
        // keep local consent even if sync fails
      });
    }
    if (resolved.analytics) {
      trackPrivacyEvent("consent_update");
    }
  }

  function navigateToRoute(route: AppRoute): void {
    setAppRoute(route);
    router.push(pathForRoute(route));
  }

  function goBack(fallback: AppRoute = "home"): void {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    navigateToRoute(fallback);
  }

  function applyRecommendedModeSetup(modeId: Mode = mode): void {
    const recommended = MODE_META[modeId].recommended;
    setDurationSec(recommended.durationSec);
    setDictionaryPack(recommended.pack as DictionaryPack);
    setModeTuning((prev) => ({ ...prev, [modeId]: DEFAULT_MODE_TUNING[modeId] }));
    if (modeId === "pulse") {
      setPulseBpm(104);
    } else if (modeId === "duel") {
      setPulseBpm(112);
    } else if (modeId === "chart") {
      setPulseBpm(124);
    }
    resetSession(true);
  }

  function updateActiveModeTuning(patch: Partial<ModeTuning>): void {
    setModeTuning((prev) => ({
      ...prev,
      [mode]: {
        ...(prev[mode] ?? DEFAULT_MODE_TUNING[mode]),
        ...patch,
      },
    }));
  }

  async function refreshLeaderboard(silent = false) {
    if (!silent) {
      setLeaderboardLoading(true);
    }
    setLeaderboardError(null);
    try {
      const data = await fetchLeaderboard(mode, 15, certifiedRun);
      setLeaderboardEntries(data.entries);
    } catch (error) {
      setLeaderboardError((error as Error).message);
    } finally {
      if (!silent) {
        setLeaderboardLoading(false);
      }
    }
  }

  useEffect(() => {
    refreshLeaderboard();
    const id = window.setInterval(() => {
      refreshLeaderboard(true);
    }, 20_000);
    return () => {
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, certifiedRun]);

  useEffect(() => {
    trackPrivacyEvent("page_view", appRoute === "play" ? { page: appRoute, mode } : { page: appRoute });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appRoute]);

  useEffect(() => {
    if (appRoute === "play") {
      trackPrivacyEvent("mode_select", { page: "play", mode });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (appRoute !== "privacy") {
      return;
    }
    if (isAnalyticsAdmin && (analyticsAdminToken.trim() || isDevEnvironment)) {
      void refreshAnalyticsSummary();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appRoute, isAnalyticsAdmin, isDevEnvironment]);

  async function refreshChallengeAndSeason(silent = false): Promise<void> {
    if (!silent) {
      setChallengeError(null);
      setSeasonError(null);
    }
    try {
      const [dailyPayload, seasonPayload] = await Promise.all([
        fetchDailyChallenge(),
        fetchCurrentSeason(),
      ]);
      setDailyChallenge(dailyPayload.challenge);
      setSeasonWindow(seasonPayload.season);

      const [challengeBoardPayload, seasonBoardPayload] = await Promise.all([
        fetchChallengeLeaderboard(dailyPayload.challenge.date, 15),
        fetchSeasonLeaderboard(seasonPayload.season.id, 25),
      ]);
      setChallengeBoard(challengeBoardPayload.entries);
      setSeasonBoard(seasonBoardPayload.entries);
      if (!silent) {
        setChallengeError(null);
        setSeasonError(null);
      }
    } catch (error) {
      const message = (error as Error).message;
      setChallengeError(message);
      setSeasonError(message);
    }
  }

  useEffect(() => {
    void refreshChallengeAndSeason();
    const id = window.setInterval(() => {
      void refreshChallengeAndSeason(true);
    }, 60_000);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  async function refreshAnalyticsSummary(): Promise<void> {
    setAnalyticsSummaryLoading(true);
    setAnalyticsSummaryError(null);
    try {
      const token = analyticsAdminToken.trim();
      const payload: AnalyticsSummaryResponse = await fetchAnalyticsSummary({
        ...(token ? { token } : {}),
        days: 14,
      });
      setAnalyticsSummaryRows(payload.rows);
      setAnalyticsSummaryTotals(payload.totals);
    } catch (error) {
      setAnalyticsSummaryError((error as Error).message);
      setAnalyticsSummaryRows([]);
      setAnalyticsSummaryTotals({});
    } finally {
      setAnalyticsSummaryLoading(false);
    }
  }

  async function refreshAdminUsers(): Promise<void> {
    if (!accountToken || !isAnalyticsAdmin) {
      setAdminUsers([]);
      return;
    }
    try {
      const payload = await fetchAdminUsers(accountToken, {
        query: adminUserQuery,
        limit: 40,
      });
      setAdminUsers(payload.users);
      setAdminNote(null);
    } catch (error) {
      setAdminNote((error as Error).message);
      setAdminUsers([]);
    }
  }

  async function refreshAdminLeaderboardRows(): Promise<void> {
    if (!accountToken || !isAnalyticsAdmin) {
      setAdminLeaderboardRows([]);
      return;
    }
    try {
      const payload = await fetchAdminLeaderboard(accountToken, {
        query: adminLeaderboardQuery,
        mode: "all",
        limit: 50,
      });
      setAdminLeaderboardRows(payload.entries);
      setAdminNote(null);
    } catch (error) {
      setAdminNote((error as Error).message);
      setAdminLeaderboardRows([]);
    }
  }

  async function removeAdminUser(user: AdminUserEntry): Promise<void> {
    if (!accountToken || !isAnalyticsAdmin) return;
    const confirmHandle = window.prompt(`Type ${user.handle} to delete this account and its related data.`);
    if (confirmHandle == null) return;
    try {
      await deleteAdminUser(accountToken, user.id, confirmHandle);
      setAdminNote(`Deleted account ${user.handle}.`);
      await Promise.all([refreshAdminUsers(), refreshAdminLeaderboardRows(), refreshLeaderboard(true)]);
    } catch (error) {
      setAdminNote((error as Error).message);
    }
  }

  async function removeAdminLeaderboardRow(row: AdminLeaderboardEntry): Promise<void> {
    if (!accountToken || !isAnalyticsAdmin) return;
    const confirmed = window.confirm(`Remove ${row.username}'s ${row.wpm.toFixed(1)} WPM ${row.mode} score?`);
    if (!confirmed) return;
    try {
      await deleteAdminLeaderboardScore(accountToken, row.id);
      setAdminNote(`Removed score ${row.id.slice(0, 8)}.`);
      await Promise.all([refreshAdminLeaderboardRows(), refreshLeaderboard(true)]);
    } catch (error) {
      setAdminNote((error as Error).message);
    }
  }

  async function seedAdminBotRows(): Promise<void> {
    if (!isAnalyticsAdmin || !accountToken) return;
    const token = botSeedToken.trim();
    if (!token && !isDevEnvironment) {
      setAdminNote("Enter the bot seed token before seeding bot rows.");
      return;
    }
    try {
      const result = await seedBotLeaderboard(accountToken, token, 12);
      setAdminNote(`Seeded ${result.rows} rows for ${result.bots} bots.`);
      await Promise.all([refreshAdminLeaderboardRows(), refreshLeaderboard(true), refreshChallengeAndSeason(true)]);
    } catch (error) {
      setAdminNote((error as Error).message);
    }
  }

  useEffect(() => {
    if (!accountToken) {
      setAccountProfile(null);
      setFriends({ friends: [], incoming: [], outgoing: [] });
      setActiveDuel(null);
      setRankedStatus("idle");
      setWebhooks([]);
      setAdminUsers([]);
      setAdminLeaderboardRows([]);
      return;
    }
    void refreshAccountProfile(accountToken);
    void refreshReplayShares();
    void refreshAccountSessions();
    if (!liveSocialEnabled) {
      setFriends({ friends: [], incoming: [], outgoing: [] });
      setActiveDuel(null);
      setRankedStatus("idle");
      setWebhooks([]);
      return;
    }
    void refreshFriends();
    void refreshRankedStatus();
    void refreshWebhooks();
    const id = window.setInterval(() => {
      void refreshFriends();
      void refreshRankedStatus();
      void refreshDuelState();
      void refreshAccountSessions();
    }, 3000);
    return () => {
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountToken, liveSocialEnabled]);

  useEffect(() => {
    if (!liveSocialEnabled) {
      clearRaceSession();
      return;
    }
    if (!raceRoomId) {
      setRaceState(null);
      return;
    }
    let cancelled = false;
    const pull = () => {
      void fetchRaceRoomState(raceRoomId)
        .then((room) => {
          if (cancelled) return;
          setRaceState(room);
          setRaceError(null);
        })
        .catch((error) => {
          if (cancelled) return;
          if (error instanceof ApiError && error.status === 404) {
            clearRaceSession("Race room ended or no longer exists");
            return;
          }
          setRaceError((error as Error).message);
        });
    };
    pull();
    const id = window.setInterval(pull, 900);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [liveSocialEnabled, raceRoomId]);

  async function createRace(): Promise<void> {
    if (!liveSocialEnabled) {
      setRaceError(socialLaunchNote);
      return;
    }
    try {
      const result = await createRaceRoom(mode, raceName.trim() || "Pilot");
      setRaceRoomId(result.roomId);
      setRaceRoomInput(result.roomId);
      setRacePlayerId(result.playerId);
      setRaceState(result.room);
      setMode(result.room.mode);
      setRaceError(null);
      router.push(pathForMode(result.room.mode));
    } catch (error) {
      setRaceError((error as Error).message);
    }
  }

  async function joinRace(): Promise<void> {
    if (!liveSocialEnabled) {
      setRaceError(socialLaunchNote);
      return;
    }
    try {
      const result = await joinRaceRoom(raceRoomInput, raceName.trim() || "Pilot");
      setRaceRoomId(result.roomId);
      setRaceRoomInput(result.roomId);
      setRacePlayerId(result.playerId);
      setRaceState(result.room);
      setMode(result.room.mode);
      setRaceError(null);
      router.push(pathForMode(result.room.mode));
    } catch (error) {
      setRaceError((error as Error).message);
    }
  }

  async function startRace(): Promise<void> {
    if (!raceRoomId || !racePlayerId) {
      return;
    }
    if (!liveSocialEnabled) {
      setRaceError(socialLaunchNote);
      return;
    }
    try {
      const room = await startRaceRoom(raceRoomId, racePlayerId);
      setRaceState(room);
      setMode(room.mode);
      setRaceError(null);
      router.push(pathForMode(room.mode));
      startSession();
    } catch (error) {
      setRaceError((error as Error).message);
    }
  }

  async function createBracket(): Promise<void> {
    if (!liveSocialEnabled) {
      setTournamentError(socialLaunchNote);
      return;
    }
    try {
      const entrants = tournamentEntrantsInput
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);
      const fallback = raceState?.players.map((player) => player.name) ?? [];
      const data = await createTournament({
        mode,
        name: tournamentName.trim() || "Orbital Cup",
        entrants: entrants.length >= 2 ? entrants : fallback,
      });
      setTournamentState(data);
      setTournamentLookupId(data.id);
      setTournamentError(null);
      router.push(pathForMode(data.mode));
    } catch (error) {
      setTournamentError((error as Error).message);
    }
  }

  useEffect(() => {
    if (!liveSocialEnabled) {
      setTournamentState(null);
      return;
    }
    const targetId = tournamentLookupId || tournamentState?.id;
    if (!targetId) {
      return;
    }
    let cancelled = false;
    const pull = () => {
      void fetchTournamentState(targetId)
        .then((nextState) => {
          if (cancelled) return;
          setTournamentState(nextState);
          setTournamentError(null);
        })
        .catch((error) => {
          if (cancelled) return;
          setTournamentError((error as Error).message);
        });
    };
    pull();
    const id = window.setInterval(pull, 1800);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [liveSocialEnabled, tournamentLookupId, tournamentState?.id]);

  async function markMatchWinner(matchId: string, winnerId: string): Promise<void> {
    if (!tournamentState) {
      return;
    }
    if (!liveSocialEnabled) {
      setTournamentError(socialLaunchNote);
      return;
    }
    try {
      const nextState = await reportTournamentMatch({
        tournamentId: tournamentState.id,
        matchId,
        winnerId,
      });
      setTournamentState(nextState);
      setTournamentError(null);
      setMode(nextState.mode);
      router.push(pathForMode(nextState.mode));
    } catch (error) {
      setTournamentError((error as Error).message);
    }
  }

  async function refreshAccountProfile(token = accountToken): Promise<void> {
    if (!token) {
      setAccountProfile(null);
      return;
    }
    try {
      const payload = await fetchAccountProfile(token);
      setAccountProfile(payload.account);
      setAccountPrefs(payload.preferences);
      setAuthHandle(payload.account.handle);
      setUsername(payload.account.handle);
      const prefs = asRecord(payload.preferences);
      if (prefs) {
        const storedConsent = asRecord(prefs.privacyConsent);
        const allowRemoteComfortPrefs = storedConsent?.preferences === true;
        if (storedConsent && storedConsent.version === PRIVACY_CONSENT_VERSION) {
          const nextConsent: PrivacyConsent = {
            version: PRIVACY_CONSENT_VERSION,
            analytics: storedConsent.analytics === true,
            preferences: storedConsent.preferences === true,
            decidedAt:
              typeof storedConsent.decidedAt === "string"
                ? storedConsent.decidedAt
                : new Date().toISOString(),
          };
          setPrivacyConsent(nextConsent);
          setConsentDraft({
            analytics: nextConsent.analytics,
            preferences: nextConsent.preferences,
          });
        }
        if (allowRemoteComfortPrefs) {
          const remoteFocusPrefs = asRecord(prefs.focusPrefs);
          if (remoteFocusPrefs) {
            setFocusPrefs((prev) => ({
              enabled: typeof remoteFocusPrefs.enabled === "boolean" ? remoteFocusPrefs.enabled : prev.enabled,
              showStats:
                typeof remoteFocusPrefs.showStats === "boolean" ? remoteFocusPrefs.showStats : prev.showStats,
              sfxEnabled:
                typeof remoteFocusPrefs.sfxEnabled === "boolean" ? remoteFocusPrefs.sfxEnabled : prev.sfxEnabled,
              musicEnabled:
                typeof remoteFocusPrefs.musicEnabled === "boolean"
                  ? remoteFocusPrefs.musicEnabled
                  : prev.musicEnabled,
              sfxVolume: clamp(Number(remoteFocusPrefs.sfxVolume ?? prev.sfxVolume), 0, 1),
              musicVolume: clamp(Number(remoteFocusPrefs.musicVolume ?? prev.musicVolume), 0, 1),
              statVisibility: Object.fromEntries(
                Object.entries({
                  ...DEFAULT_FOCUS_STAT_VISIBILITY,
                  ...prev.statVisibility,
                  ...(asRecord(remoteFocusPrefs.statVisibility) ?? {}),
                }).map(([key, value]) => [key, value === true]),
              ),
            }));
          }
          if (prefs.theme === "dark" || prefs.theme === "light") {
            setTheme(prefs.theme);
          }
          if (typeof prefs.durationSec === "number") {
            setDurationSec(clamp(Math.round(prefs.durationSec), 30, 120));
          }
          if (
            prefs.dictionaryPack === "core" ||
            prefs.dictionaryPack === "tech" ||
            prefs.dictionaryPack === "myth" ||
            prefs.dictionaryPack === "blitz" ||
            prefs.dictionaryPack === "top1k" ||
            prefs.dictionaryPack === "top5k" ||
            prefs.dictionaryPack === "top10k" ||
            prefs.dictionaryPack === "verbs" ||
            prefs.dictionaryPack === "nouns" ||
            prefs.dictionaryPack === "code" ||
            prefs.dictionaryPack === "spanish" ||
            prefs.dictionaryPack === "french" ||
            prefs.dictionaryPack === "german"
          ) {
            setDictionaryPack(prefs.dictionaryPack);
          }
        }
      }
      setAuthNote(null);
    } catch (error) {
      setAuthNote((error as Error).message);
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setAccountToken("");
        setAccountProfile(null);
      }
    }
  }

  async function registerAccountFlow(): Promise<void> {
    const handle = authHandle.trim();
    if (!handleLooksValid(handle)) {
      setAuthNote("Handle must be 2-24 chars and only use letters, numbers, spaces, dots, dashes, or underscores.");
      return;
    }
    if (!passwordLooksValid(authPassword)) {
      setAuthNote("Password must be at least 10 chars with uppercase, lowercase, and a number.");
      return;
    }
    if (turnstileSiteKey && !authTurnstileToken) {
      setAuthNote("Complete the anti-bot check before registering.");
      return;
    }
    try {
      const payload = await registerAccount({
        handle,
        password: authPassword,
        locale: authLocale,
        ...(authTurnstileToken ? { turnstileToken: authTurnstileToken } : {}),
      });
      setAccountToken(payload.token);
      setAccountProfile(payload.account);
      setUsername(payload.account.handle);
      setAuthPassword("");
      setAuthNote("Account created and signed in.");
      trackPrivacyEvent("auth_register", { page: "profile" });
      await refreshAccountProfile(payload.token);
    } catch (error) {
      setAuthNote((error as Error).message);
    } finally {
      if (turnstileSiteKey) {
        setAuthTurnstileToken("");
        setAuthTurnstileResetKey((value) => value + 1);
      }
    }
  }

  async function loginAccountFlow(): Promise<void> {
    const handle = authHandle.trim();
    if (!handleLooksValid(handle)) {
      setAuthNote("Enter the same handle format you registered with.");
      return;
    }
    if (!authPassword) {
      setAuthNote("Password is required.");
      return;
    }
    if (turnstileSiteKey && !authTurnstileToken) {
      setAuthNote("Complete the anti-bot check before logging in.");
      return;
    }
    try {
      const payload = await loginAccount({
        handle,
        password: authPassword,
        ...(authTurnstileToken ? { turnstileToken: authTurnstileToken } : {}),
      });
      setAccountToken(payload.token);
      setAccountProfile(payload.account);
      setUsername(payload.account.handle);
      setAuthPassword("");
      setAuthNote("Signed in.");
      trackPrivacyEvent("auth_login", { page: "profile" });
      await refreshAccountProfile(payload.token);
    } catch (error) {
      setAuthNote((error as Error).message);
    } finally {
      if (turnstileSiteKey) {
        setAuthTurnstileToken("");
        setAuthTurnstileResetKey((value) => value + 1);
      }
    }
  }

  async function refreshAccountSessions(): Promise<void> {
    if (!accountToken) return;
    try {
      const payload = await fetchAccountSessions(accountToken);
      setAccountSessionId(payload.currentSessionId);
      setAccountSessions(payload.sessions);
    } catch (error) {
      setAccountLifecycleNote((error as Error).message);
    }
  }

  async function changePasswordFlow(): Promise<void> {
    if (!accountToken) return;
    if (!authPassword) {
      setAccountLifecycleNote("Current password is required.");
      return;
    }
    if (!passwordLooksValid(authNewPassword)) {
      setAccountLifecycleNote("New password must be at least 10 chars with uppercase, lowercase, and a number.");
      return;
    }
    try {
      await changeAccountPassword(accountToken, {
        currentPassword: authPassword,
        newPassword: authNewPassword,
      });
      setAuthPassword("");
      setAuthNewPassword("");
      setAccountLifecycleNote("Password updated. Other active sessions were signed out.");
      await refreshAccountSessions();
    } catch (error) {
      setAccountLifecycleNote((error as Error).message);
    }
  }

  async function exportAccountDataFlow(): Promise<void> {
    if (!accountToken) return;
    try {
      const payload = await exportAccountData(accountToken);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `typeshift-account-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setAccountLifecycleNote("Account export downloaded.");
    } catch (error) {
      setAccountLifecycleNote((error as Error).message);
    }
  }

  async function logoutCurrentAccountFlow(): Promise<void> {
    if (!accountToken) return;
    try {
      await logoutCurrentAccount(accountToken);
    } catch (_error) {
      // local logout should still proceed
    }
    setAccountToken("");
    setAccountProfile(null);
    setAccountSessions([]);
    setAccountLifecycleNote("Signed out.");
  }

  async function logoutOtherSessionsFlow(): Promise<void> {
    if (!accountToken) return;
    try {
      await logoutOtherAccountSessions(accountToken);
      setAccountLifecycleNote("Other active sessions were signed out.");
      await refreshAccountSessions();
    } catch (error) {
      setAccountLifecycleNote((error as Error).message);
    }
  }

  async function revokeSessionFlow(sessionId: string): Promise<void> {
    if (!accountToken) return;
    try {
      const payload = await revokeAccountSession(accountToken, sessionId);
      if (payload.currentSessionRevoked) {
        setAccountToken("");
        setAccountProfile(null);
        setAccountSessions([]);
        setAccountLifecycleNote("Current session signed out.");
        return;
      }
      setAccountLifecycleNote("Session removed.");
      await refreshAccountSessions();
    } catch (error) {
      setAccountLifecycleNote((error as Error).message);
    }
  }

  async function deleteAccountFlow(): Promise<void> {
    if (!accountToken || !accountProfile) return;
    if (deleteHandleConfirm.trim() !== accountProfile.handle) {
      setAccountLifecycleNote("Type your exact handle to confirm deletion.");
      return;
    }
    try {
      await deleteAccount(accountToken, deleteHandleConfirm.trim());
      setAccountToken("");
      setAccountProfile(null);
      setAccountSessions([]);
      setDeleteHandleConfirm("");
      setDeleteModalOpen(false);
      setAccountLifecycleNote("Account deleted.");
    } catch (error) {
      setAccountLifecycleNote((error as Error).message);
    }
  }

  function openDeleteModal(): void {
    setDeleteHandleConfirm("");
    setDeleteModalOpen(true);
  }

  function closeDeleteModal(): void {
    setDeleteModalOpen(false);
    setDeleteHandleConfirm("");
  }

  async function refreshFriends(): Promise<void> {
    if (!liveSocialEnabled) {
      setFriends({ friends: [], incoming: [], outgoing: [] });
      return;
    }
    if (!accountToken) return;
    try {
      const payload = await fetchFriends(accountToken);
      setFriends(payload);
    } catch (_error) {
      // keep UI responsive
    }
  }

  async function sendFriendRequest(): Promise<void> {
    if (!accountToken || !friendHandle.trim()) return;
    if (!liveSocialEnabled) {
      setAuthNote(socialLaunchNote);
      return;
    }
    try {
      await requestFriend(accountToken, friendHandle.trim());
      setFriendHandle("");
      await refreshFriends();
    } catch (error) {
      setAuthNote((error as Error).message);
    }
  }

  async function respondFriendRequest(requestId: string, accept: boolean): Promise<void> {
    if (!accountToken) return;
    if (!liveSocialEnabled) {
      setAuthNote(socialLaunchNote);
      return;
    }
    try {
      await respondFriend(accountToken, requestId, accept);
      await refreshFriends();
    } catch (error) {
      setAuthNote((error as Error).message);
    }
  }

  async function enqueueRankedFlow(): Promise<void> {
    if (!accountToken) return;
    setDuelQueueAction("ranked");
    setDuelNote("Joining ranked queue...");
    if (!liveSocialEnabled) {
      setDuelNote(socialLaunchNote);
      return;
    }
    try {
      const result = await enqueueRanked(accountToken);
      setRankedStatus(result.status);
      setDuelNote(result.duel ? "Ranked duel found." : `Ranked queue: ${result.status}`);
      if (result.duel) {
        setActiveDuel(result.duel);
      }
    } catch (error) {
      setDuelNote((error as Error).message);
    }
  }

  async function enqueueDuelFlow(): Promise<void> {
    if (!accountToken) return;
    setDuelQueueAction("casual");
    setDuelNote("Joining casual duel...");
    if (!liveSocialEnabled) {
      setDuelNote(socialLaunchNote);
      return;
    }
    try {
      const result = await enqueueCasualDuel(accountToken);
      setRankedStatus(result.status);
      setDuelNote(result.duel ? "Casual duel found." : `Casual queue: ${result.status}`);
      if (result.duel) {
        setActiveDuel(result.duel);
      }
    } catch (error) {
      setDuelNote((error as Error).message);
    }
  }

  async function refreshRankedStatus(): Promise<void> {
    setDuelQueueAction("status");
    if (!liveSocialEnabled) {
      setRankedStatus("idle");
      return;
    }
    if (!accountToken) return;
    try {
      const status = await fetchRankedStatus(accountToken);
      setRankedStatus(status.status);
      setDuelNote(`Queue: ${status.status}`);
      if (status.duel) {
        setActiveDuel(status.duel);
      }
    } catch (_error) {
      // no-op
    }
  }

  async function refreshDuelState(): Promise<void> {
    if (!liveSocialEnabled) {
      setActiveDuel(null);
      return;
    }
    if (!accountToken || !activeDuel) return;
    try {
      const payload = await fetchDuelState(accountToken, activeDuel.id);
      setActiveDuel(payload.duel);
    } catch (_error) {
      // no-op
    }
  }

  async function pushDuelProgress(finished = false): Promise<void> {
    if (!liveSocialEnabled) {
      return;
    }
    if (!accountToken || !activeDuel) return;
    try {
      const payload = await updateDuelState(accountToken, {
        duelId: activeDuel.id,
        progress: computeRaceProgress(),
        wpm: stats.wpm,
        accuracy: stats.accuracy,
        finished,
      });
      setActiveDuel(payload.duel);
    } catch (_error) {
      // no-op
    }
  }

  async function shareSelectedReplay(): Promise<void> {
    const source =
      replays.find((item) => item.id === selectedReplayId) ??
      replays[0];
    if (!source) {
      setReplayNote("No replay to share.");
      return;
    }
    if (!accountToken) {
      setReplayNote("Sign in to publish replay shares on the Cloudflare launch.");
      return;
    }
    try {
      const payload = await shareReplay({
        token: accountToken,
        mode: source.mode,
        title: replayShareTitle.trim() || "Shared run",
        replay: source as unknown as Record<string, unknown>,
        isPublic: true,
      });
      setReplayNote(`Replay shared: ${payload.id}`);
      await refreshReplayShares();
    } catch (error) {
      setReplayNote((error as Error).message);
    }
  }

  async function loadSharedReplay(): Promise<void> {
    if (!sharedReplayIdInput.trim()) return;
    try {
      const payload = await fetchSharedReplay(sharedReplayIdInput.trim());
      setLoadedSharedReplay({
        id: payload.id,
        accountId: payload.accountId,
        mode: payload.mode,
        title: payload.title,
        isPublic: payload.isPublic,
        createdAt: payload.createdAt,
      });
      setReplayNote(`Loaded shared replay ${payload.id}.`);
    } catch (error) {
      setReplayNote((error as Error).message);
    }
  }

  async function refreshReplayShares(): Promise<void> {
    try {
      const payload = await listReplayShares({
        mine: Boolean(accountToken),
        ...(accountToken ? { token: accountToken } : {}),
      });
      setReplayShares(payload.entries);
    } catch (_error) {
      // no-op
    }
  }

  async function refreshWebhooks(): Promise<void> {
    if (!liveSocialEnabled) {
      setWebhooks([]);
      setWebhookNote(socialLaunchNote);
      return;
    }
    if (!accountToken) {
      setWebhooks([]);
      setWebhookNote("Sign in to manage webhook endpoints.");
      return;
    }
    try {
      const payload = await listWebhooks(accountToken);
      setWebhooks(payload.entries);
      setWebhookNote(`Loaded ${payload.entries.length} webhook${payload.entries.length === 1 ? "" : "s"}.`);
    } catch (_error) {
      setWebhookNote((_error as Error).message);
    }
  }

  async function createWebhookFlow(): Promise<void> {
    if (!accountToken || !webhookUrl.trim()) return;
    if (!liveSocialEnabled) {
      setWebhookNote(socialLaunchNote);
      return;
    }
    try {
      const created = await createWebhook(
        accountToken,
        webhookUrl.trim(),
        webhookEvents
          .split(",")
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
      );
      setWebhookNote(`Webhook created. Secret: ${created.secret ?? "hidden"}`);
      setWebhookUrl("");
      await refreshWebhooks();
    } catch (error) {
      setWebhookNote((error as Error).message);
    }
  }

  async function deleteWebhookFlow(id: string): Promise<void> {
    if (!accountToken) return;
    if (!liveSocialEnabled) {
      setWebhookNote(socialLaunchNote);
      return;
    }
    try {
      await deleteWebhook(accountToken, id);
      setWebhookNote("Webhook removed.");
      await refreshWebhooks();
    } catch (error) {
      setWebhookNote((error as Error).message);
    }
  }

  async function testWebhookFlow(id: string): Promise<void> {
    if (!accountToken) return;
    if (!liveSocialEnabled) {
      setWebhookNote(socialLaunchNote);
      return;
    }
    try {
      await testWebhook(accountToken, id);
      setWebhookNote("Webhook test sent.");
    } catch (error) {
      setWebhookNote((error as Error).message);
    }
  }

  function activateDailyChallenge(): void {
    if (!dailyChallenge) {
      return;
    }
    setMode(dailyChallenge.mode);
    setDurationSec(dailyChallenge.durationSec);
    setDictionaryPack(dailyChallenge.dictionaryPack as DictionaryPack);
    setChallengeActive(true);
    setChallengeNote(`Challenge loaded: ${dailyChallenge.id}`);
    announce(`Daily challenge preset loaded for ${dailyChallenge.date}`);
    resetSession(true);
  }

  useEffect(() => {
    if (!challengeActive || !dailyChallenge) {
      return;
    }
    const stillMatching =
      mode === dailyChallenge.mode &&
      durationSec === dailyChallenge.durationSec &&
      dictionaryPack === (dailyChallenge.dictionaryPack as DictionaryPack);
    if (!stillMatching) {
      setChallengeActive(false);
      setChallengeNote("Challenge preset changed. Run will not submit to daily board.");
      announce("Challenge preset changed. Daily challenge submission is disabled until you reload it.");
    }
  }, [challengeActive, dailyChallenge, mode, durationSec, dictionaryPack]);

  function syncMeteorSelection() {
    const runtime = runtimeRef.current;
    setMeteorSelection((prev) => {
      if (prev.id === runtime.meteorLockId && prev.typed === runtime.meteorBuffer) {
        return prev;
      }
      return {
        id: runtime.meteorLockId,
        typed: runtime.meteorBuffer,
      };
    });
  }

  function clearMeteorSelection() {
    const runtime = runtimeRef.current;
    runtime.meteorLockId = null;
    runtime.meteorBuffer = "";
    syncMeteorSelection();
  }

  function saveBestForMode(nextWpm: number) {
    setBestByMode((prev) => {
      const current = prev[mode] ?? 0;
      if (nextWpm <= current) {
        return prev;
      }
      const next = { ...prev, [mode]: Number(nextWpm.toFixed(1)) };
      localStorage.setItem(STORAGE_BEST, JSON.stringify(next));
      return next;
    });
  }

  function updateLiveStats() {
    const runtime = runtimeRef.current;
    const summary = scoreSummary(runtime);
    const cpm = (runtime.rawChars / summary.elapsedSec) * 60;
    const kps = runtime.rawChars / summary.elapsedSec;
    const efficiency = runtime.rawChars > 0 ? (runtime.correctChars / runtime.rawChars) * 100 : 100;
    const nextStats = {
      wpm: summary.wpm,
      raw: summary.raw,
      cpm,
      kps,
      accuracy: summary.accuracy,
      efficiency,
      errors: runtime.errors,
      streak: runtime.streak,
      maxStreak: runtime.maxStreak,
      elapsedSec: summary.elapsedSec,
      completedWords: runtime.completedWords,
      correctChars: runtime.correctChars,
      wrongChars: runtime.wrongChars,
      lives: runtime.lives,
    };
    adaptiveMusicRef.current = {
      wpm: summary.wpm,
      accuracy: summary.accuracy,
      streak: runtime.streak,
      bpm: clamp(Math.round(82 + summary.wpm * 0.62 + Math.min(runtime.streak, 30) * 0.35), 82, 176),
    };
    setStats(nextStats);
  }

  function showPulseJudge(label: string, tone: PulseJudgeTone) {
    setPulseJudge({ label, tone });
    playJudgeSfx(tone);
    if (pulseJudgeTimeoutRef.current) {
      window.clearTimeout(pulseJudgeTimeoutRef.current);
    }
    pulseJudgeTimeoutRef.current = window.setTimeout(() => {
      setPulseJudge(null);
      pulseJudgeTimeoutRef.current = 0;
    }, 700);
  }

  function logReplayEvent(kind: ReplayEvent["kind"], key: string, correct: boolean): void {
    const runtime = runtimeRef.current;
    if (runtime.status !== "running") {
      return;
    }
    const t = Math.max(0, performance.now() - runtime.startMs);
    keyEventsRef.current.push({ t, key, kind, correct });
    if (keyEventsRef.current.length > 6000) {
      keyEventsRef.current = keyEventsRef.current.slice(-6000);
    }
  }

  function bumpKeyStat(rawKey: string, correct: boolean): void {
    const key = rawKey.toLowerCase();
    if (!/^[a-z0-9]$/.test(key)) {
      return;
    }
    setKeyStats((prev) => {
      const current = prev[key] ?? { hits: 0, errors: 0 };
      const next = {
        hits: current.hits + 1,
        errors: current.errors + (correct ? 0 : 1),
      };
      return { ...prev, [key]: next };
    });
  }

  function pushWeakness(target: string, typed: string): void {
    const patterns = extractWeakPatterns(target, typed);
    if (patterns.length === 0) return;
    setWeaknessMap((prev) => {
      const next = { ...prev };
      for (const pattern of patterns) {
        next[pattern] = (next[pattern] ?? 0) + 1;
      }
      return next;
    });
  }

  function noteKeyInterval(): void {
    const runtime = runtimeRef.current;
    if (runtime.status !== "running") {
      return;
    }
    const now = performance.now();
    if (lastKeyTsRef.current > 0) {
      const interval = now - lastKeyTsRef.current;
      keyIntervalsRef.current.push(interval);
      if (keyIntervalsRef.current.length > 5000) {
        keyIntervalsRef.current = keyIntervalsRef.current.slice(-5000);
      }
    }
    lastKeyTsRef.current = now;
  }

  function computeRaceProgress(): number {
    const runtime = runtimeRef.current;
    if (mode === "meteor") {
      return clamp(runtime.completedWords * 2.4, 0, 100);
    }
    const total = Math.max(1, promptWordsRef.current.length);
    return clamp((currentIndexRef.current / total) * 100, 0, 100);
  }

  function rogueOffers(): RogueOffer[] {
    const offers: RogueOffer[] = [
      {
        id: "overclock",
        name: "Overclock Core",
        description: "+20% score gain",
        apply: (buffs) => ({ ...buffs, scoreMultiplier: buffs.scoreMultiplier + 0.2 }),
      },
      {
        id: "shield",
        name: "Nano Shield",
        description: "Ignore next 6 mistakes",
        apply: (buffs) => ({ ...buffs, shieldCharges: buffs.shieldCharges + 6 }),
      },
      {
        id: "stabilizer",
        name: "Gyro Stabilizer",
        description: "Mistake penalty reduced",
        apply: (buffs) => ({ ...buffs, wrongPenaltyScale: buffs.wrongPenaltyScale * 0.6 }),
      },
      {
        id: "combo",
        name: "Combo Reactor",
        description: "Extra bonus on long streaks",
        apply: (buffs) => ({ ...buffs, comboBonus: buffs.comboBonus + 1 }),
      },
      {
        id: "time",
        name: "Time Warp",
        description: "+12s run time",
        apply: (buffs) => ({ ...buffs, extraTimeSec: buffs.extraTimeSec + 12 }),
      },
    ];
    return randomPick(offers, 3);
  }

  function applyRogueOffer(choiceIndex: number): void {
    const currentOffers = rogueOffer;
    if (!currentOffers) {
      return;
    }
    const picked = currentOffers[choiceIndex];
    if (!picked) {
      return;
    }
    rogueBuffsRef.current = picked.apply(rogueBuffsRef.current);
    setRogueBuffLabel(`${picked.name}: ${picked.description}`);
    setRogueOffer(null);
  }

  function clearLoops() {
    const runtime = runtimeRef.current;
    if (runtime.hudRaf) {
      cancelAnimationFrame(runtime.hudRaf);
      runtime.hudRaf = 0;
    }
    if (runtime.meteorRaf) {
      cancelAnimationFrame(runtime.meteorRaf);
      runtime.meteorRaf = 0;
    }
    if (musicLoopRef.current) {
      window.clearInterval(musicLoopRef.current);
      musicLoopRef.current = 0;
    }
  }

  function scheduleFxCleanup(callback: () => void, delayMs: number) {
    const timeoutId = window.setTimeout(() => {
      callback();
      fxTimeoutsRef.current = fxTimeoutsRef.current.filter((id) => id !== timeoutId);
    }, delayMs);
    fxTimeoutsRef.current.push(timeoutId);
  }

  function getAudioContext(): AudioContext | null {
    if (soundPack === "mute") {
      return null;
    }
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      if (audioCtxRef.current.state === "suspended") {
        void audioCtxRef.current.resume();
      }
      return audioCtxRef.current;
    } catch (_error) {
      return null;
    }
  }

  function musicProfileForMode(currentMode: Mode): {
    intervalMs: number;
    lead: number[];
    bass: number[];
    leadType: OscillatorType;
    accentType: OscillatorType;
  } {
    if (currentMode === "meteor") {
      return {
        intervalMs: 360,
        lead: [392, 440, 523.25, 659.25, 587.33, 523.25],
        bass: [130.81, 146.83, 164.81, 174.61],
        leadType: "triangle",
        accentType: "sawtooth",
      };
    }
    if (currentMode === "pulse" || currentMode === "duel" || currentMode === "chart") {
      return {
        intervalMs: Math.max(140, Math.round((60_000 / Math.max(70, pulseBpm)) / 2)),
        lead: [523.25, 587.33, 659.25, 783.99, 659.25, 587.33],
        bass: [130.81, 146.83, 164.81, 196],
        leadType: "square",
        accentType: "triangle",
      };
    }
    return {
      intervalMs: 430,
      lead: [261.63, 329.63, 392, 440, 392, 329.63],
      bass: [98, 110, 130.81, 146.83],
      leadType: "sine",
      accentType: "triangle",
    };
  }

  function playMusicTone(
    ctx: AudioContext,
    input: {
      frequency: number;
      durationSec: number;
      volume: number;
      type: OscillatorType;
      startAt?: number;
    },
  ): void {
    const startAt = input.startAt ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(input.frequency * 5.5, startAt);
    osc.type = input.type;
    osc.frequency.setValueAtTime(input.frequency, startAt);
    gain.gain.setValueAtTime(0.001, startAt);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, input.volume * focusPrefs.musicVolume), startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + input.durationSec);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + input.durationSec + 0.04);
  }

  function startMusicLoop(): void {
    if (!focusPrefs.musicEnabled || soundPack === "mute") {
      return;
    }
    const ctx = getAudioContext();
    if (!ctx) {
      return;
    }
    if (musicLoopRef.current) {
      window.clearInterval(musicLoopRef.current);
      musicLoopRef.current = 0;
    }
    musicStepRef.current = 0;
    const tick = () => {
      if (runtimeRef.current.status !== "running") {
        return;
      }
      const profile = musicProfileForMode(mode);
      const adaptive = adaptiveMusicRef.current;
      const step = musicStepRef.current++;
      const now = ctx.currentTime + 0.02;
      const variation = Math.floor(step / 16) % 3;
      const leadIndex = (step + variation * 2 + (adaptive.accuracy < 92 ? 1 : 0)) % profile.lead.length;
      const leadFreq = profile.lead[leadIndex] ?? profile.lead[0] ?? 261.63;
      const bassFreq = profile.bass[(Math.floor(step / 2) + variation) % profile.bass.length] ?? profile.bass[0] ?? 98;
      const intervalMs = Math.round((60_000 / adaptive.bpm) / 2);
      const intensity = clamp(0.65 + adaptive.wpm / 220, 0.65, 1.35);
      playMusicTone(ctx, {
        frequency: leadFreq,
        durationSec: intervalMs / 1000,
        volume: (mode === "meteor" ? 0.045 : 0.032) * intensity,
        type: profile.leadType,
        startAt: now,
      });
      if (step % 2 === 0) {
        playMusicTone(ctx, {
          frequency: bassFreq,
          durationSec: (intervalMs / 1000) * 1.8,
          volume: (mode === "meteor" ? 0.042 : 0.026) * intensity,
          type: "sine",
          startAt: now,
        });
      }
      if (mode === "pulse" || mode === "duel" || mode === "chart") {
        playMusicTone(ctx, {
          frequency: leadFreq * 2,
          durationSec: 0.08,
          volume: 0.018,
          type: profile.accentType,
          startAt: now,
        });
      }
      if (adaptive.streak >= 8 && step % 4 === 3) {
        playMusicTone(ctx, {
          frequency: leadFreq * (adaptive.accuracy >= 96 ? 1.5 : 1.25),
          durationSec: 0.055,
          volume: 0.012 * intensity,
          type: profile.accentType,
          startAt: now,
        });
      }
      musicLoopRef.current = window.setTimeout(tick, intervalMs);
    };
    tick();
  }

  function playLaserSfx() {
    if (!focusPrefs.sfxEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const sfxLevel = Math.max(0.001, focusPrefs.sfxVolume);
    if (soundPack === "retro") {
      osc.type = "square";
      osc.frequency.setValueAtTime(720, now);
      osc.frequency.exponentialRampToValueAtTime(280, now + 0.07);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.09 * sfxLevel, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    } else if (soundPack === "cinematic") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(960, now);
      osc.frequency.exponentialRampToValueAtTime(210, now + 0.12);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.15 * sfxLevel, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    } else if (soundPack === "soft") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(820, now);
      osc.frequency.exponentialRampToValueAtTime(430, now + 0.09);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.07 * sfxLevel, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    } else {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(260, now + 0.08);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.13 * sfxLevel, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    }
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  function playLockSfx() {
    if (!focusPrefs.sfxEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const sfxLevel = Math.max(0.001, focusPrefs.sfxVolume);
    osc.type = soundPack === "retro" ? "square" : "triangle";
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(760, now + 0.06);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime((soundPack === "soft" ? 0.04 : 0.08) * sfxLevel, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  function playJudgeSfx(tone: PulseJudgeTone) {
    if (!focusPrefs.sfxEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const sfxLevel = Math.max(0.001, focusPrefs.sfxVolume);
    const frequency =
      tone === "perfect" ? 760 : tone === "great" ? 620 : tone === "ok" ? 480 : 220;
    const lead = ctx.createOscillator();
    const leadGain = ctx.createGain();
    lead.type = tone === "miss" ? "sawtooth" : "triangle";
    lead.frequency.setValueAtTime(frequency, now);
    lead.frequency.exponentialRampToValueAtTime(tone === "miss" ? 140 : frequency * 0.72, now + 0.12);
    leadGain.gain.setValueAtTime(0.001, now);
    leadGain.gain.exponentialRampToValueAtTime((tone === "perfect" ? 0.1 : 0.065) * sfxLevel, now + 0.015);
    leadGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    lead.connect(leadGain);
    leadGain.connect(ctx.destination);
    lead.start(now);
    lead.stop(now + 0.16);

    if (tone !== "miss") {
      const sparkle = ctx.createOscillator();
      const sparkleGain = ctx.createGain();
      sparkle.type = soundPack === "retro" ? "square" : "sine";
      sparkle.frequency.setValueAtTime(frequency * 2.02, now);
      sparkle.frequency.exponentialRampToValueAtTime(frequency * 1.2, now + 0.09);
      sparkleGain.gain.setValueAtTime(0.001, now);
      sparkleGain.gain.exponentialRampToValueAtTime((tone === "perfect" ? 0.045 : 0.025) * sfxLevel, now + 0.01);
      sparkleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      sparkle.connect(sparkleGain);
      sparkleGain.connect(ctx.destination);
      sparkle.start(now);
      sparkle.stop(now + 0.12);
    }
  }

  function playExplosionSfx() {
    if (!focusPrefs.sfxEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const sfxLevel = Math.max(0.001, focusPrefs.sfxVolume);
    const body = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    const crack = ctx.createOscillator();
    const crackGain = ctx.createGain();
    if (soundPack === "retro") {
      body.type = "square";
      body.frequency.setValueAtTime(160, now);
      body.frequency.exponentialRampToValueAtTime(50, now + 0.22);
      bodyGain.gain.setValueAtTime(0.001, now);
      bodyGain.gain.exponentialRampToValueAtTime(0.12 * sfxLevel, now + 0.02);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      crack.type = "square";
      crack.frequency.setValueAtTime(540, now);
      crack.frequency.exponentialRampToValueAtTime(120, now + 0.08);
      crackGain.gain.setValueAtTime(0.001, now);
      crackGain.gain.exponentialRampToValueAtTime(0.04 * sfxLevel, now + 0.008);
      crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    } else if (soundPack === "cinematic") {
      body.type = "triangle";
      body.frequency.setValueAtTime(210, now);
      body.frequency.exponentialRampToValueAtTime(42, now + 0.35);
      bodyGain.gain.setValueAtTime(0.001, now);
      bodyGain.gain.exponentialRampToValueAtTime(0.24 * sfxLevel, now + 0.04);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      crack.type = "sawtooth";
      crack.frequency.setValueAtTime(860, now);
      crack.frequency.exponentialRampToValueAtTime(140, now + 0.12);
      crackGain.gain.setValueAtTime(0.001, now);
      crackGain.gain.exponentialRampToValueAtTime(0.05 * sfxLevel, now + 0.012);
      crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    } else if (soundPack === "soft") {
      body.type = "sine";
      body.frequency.setValueAtTime(220, now);
      body.frequency.exponentialRampToValueAtTime(80, now + 0.2);
      bodyGain.gain.setValueAtTime(0.001, now);
      bodyGain.gain.exponentialRampToValueAtTime(0.1 * sfxLevel, now + 0.03);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      crack.type = "triangle";
      crack.frequency.setValueAtTime(600, now);
      crack.frequency.exponentialRampToValueAtTime(180, now + 0.09);
      crackGain.gain.setValueAtTime(0.001, now);
      crackGain.gain.exponentialRampToValueAtTime(0.02 * sfxLevel, now + 0.01);
      crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    } else {
      body.type = "triangle";
      body.frequency.setValueAtTime(180, now);
      body.frequency.exponentialRampToValueAtTime(58, now + 0.25);
      bodyGain.gain.setValueAtTime(0.001, now);
      bodyGain.gain.exponentialRampToValueAtTime(0.19 * sfxLevel, now + 0.03);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      crack.type = "sawtooth";
      crack.frequency.setValueAtTime(720, now);
      crack.frequency.exponentialRampToValueAtTime(150, now + 0.1);
      crackGain.gain.setValueAtTime(0.001, now);
      crackGain.gain.exponentialRampToValueAtTime(0.045 * sfxLevel, now + 0.012);
      crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    }
    body.connect(bodyGain);
    crack.connect(crackGain);
    bodyGain.connect(ctx.destination);
    crackGain.connect(ctx.destination);
    body.start(now);
    crack.start(now);
    body.stop(now + 0.42);
    crack.stop(now + 0.16);
  }

  function triggerLaser(word: MeteorWord) {
    const id = ++fxIdRef.current;
    setLaserFx((prev) => [...prev, { id, xPercent: word.xPercent, yPercent: word.yPercent, lockId: word.id }]);
    scheduleFxCleanup(() => {
      setLaserFx((prev) => prev.filter((fx) => fx.id !== id));
    }, 90);
    playLaserSfx();
  }

  function triggerExplosion(word: MeteorWord) {
    const id = ++fxIdRef.current;
    setExplosionFx((prev) => [...prev, { id, xPercent: word.xPercent, yPercent: word.yPercent }]);
    scheduleFxCleanup(() => {
      setExplosionFx((prev) => prev.filter((fx) => fx.id !== id));
    }, 460);
    playExplosionSfx();
  }

  useEffect(() => {
    if (isRunning && focusPrefs.musicEnabled && soundPack !== "mute") {
      startMusicLoop();
    } else if (musicLoopRef.current) {
      window.clearInterval(musicLoopRef.current);
      musicLoopRef.current = 0;
    }
    return () => {
      if (musicLoopRef.current) {
        window.clearInterval(musicLoopRef.current);
        musicLoopRef.current = 0;
      }
    };
  }, [focusPrefs.musicEnabled, focusPrefs.musicVolume, isRunning, mode, pulseBpm, soundPack]);

  function spawnMeteorWord(yPercent?: number, speed?: number) {
    const runtime = runtimeRef.current;
    const sourcePool = playPool.filter((candidate) => candidate.length <= 8);
    const word = sourcePool[Math.floor(Math.random() * sourcePool.length)] ?? "signal";
    runtime.meteorWordId += 1;

    // Spawn near/off the top so meteors travel farther before reaching the floor.
    const spawnY = yPercent ?? -26 + Math.random() * 14;
    const spawnSpeed = speed ?? 4.2 + Math.random() * 3.6;

    runtime.meteorWords.push({
      id: runtime.meteorWordId,
      text: word,
      xPercent: Math.random() * 82 + 6,
      yPercent: spawnY,
      speed: spawnSpeed,
    });
  }

  function seedMeteorField() {
    const runtime = runtimeRef.current;
    runtime.meteorWords = [];
    runtime.meteorWordId = 0;

    for (let i = 0; i < 4; i += 1) {
      const y = -20 + Math.random() * 22;
      const speed = 4 + Math.random() * 2.8;
      spawnMeteorWord(y, speed);
    }

    setMeteorWordsView([...runtime.meteorWords]);
  }

  function resetSession(remix: boolean) {
    clearLoops();
    setIsRunning(false);

    const runtime = runtimeRef.current;
    runtime.status = "idle";
    runtime.runNonce += 1;
    runtime.startMs = 0;
    runtime.finishMs = 0;
    runtime.correctChars = 0;
    runtime.wrongChars = 0;
    runtime.rawChars = 0;
    runtime.errors = 0;
    runtime.streak = 0;
    runtime.maxStreak = 0;
    runtime.completedWords = 0;
    runtime.lives = 5;
    runtime.meteorWords = [];
    runtime.meteorSpawnClock = 0;
    runtime.meteorLastTs = 0;
    runtime.meteorLastPaint = 0;
    runtime.meteorLockId = null;
    runtime.meteorBuffer = "";
    runtime.sessionId = null;
    runtime.sessionToken = null;
    runtime.lastHudPaint = 0;
    runSamplesRef.current = [];
    keyEventsRef.current = [];
    keyIntervalsRef.current = [];
    submittedHistoryRef.current = [];
    lastKeyTsRef.current = 0;
    echoPendingRef.current = null;
    rogueBuffsRef.current = {
      scoreMultiplier: 1,
      shieldCharges: 0,
      wrongPenaltyScale: 1,
      comboBonus: 0,
      extraTimeSec: 0,
    };
    racePushAtRef.current = 0;

    if (previewRafRef.current) {
      cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = 0;
    }

    typedRef.current = "";
    pendingPreviewRef.current = "";
    setTypedPreview("");
    currentIndexRef.current = 0;
    setCurrentIndex(0);
    setWordResults([]);
    setCodeLineStarts({});
    setMeteorWordsView([]);
    setMeteorSelection({ id: null, typed: "" });
    setLaserFx([]);
    setExplosionFx([]);
    if (pulseJudgeTimeoutRef.current) {
      window.clearTimeout(pulseJudgeTimeoutRef.current);
      pulseJudgeTimeoutRef.current = 0;
    }
    setPulseJudge(null);
    setEchoPending(null);
    setRogueOffer(null);
    setRogueBuffLabel("No perks yet");
    setDuelRivalProgress(0);
    setChainCombo(1);
    setCoopTurn(1);
    setInfectedIndices([]);
    setGhostStatus("No ghost");
    setPhase("Ready");
    setReport(null);
    setTimerText(MODE_META[mode].timed ? formatSeconds(durationSec) : "∞");
    setStats({
      wpm: 0,
      raw: 0,
      cpm: 0,
      kps: 0,
      accuracy: 100,
      efficiency: 100,
      errors: 0,
      streak: 0,
      maxStreak: 0,
      elapsedSec: 0,
      completedWords: 0,
      correctChars: 0,
      wrongChars: 0,
      lives: 5,
    });

    if (!remix) return;

    announce("Run reset. Ready when you are.");

    if (mode === "meteor") {
      promptWordsRef.current = [];
      setPromptWords([]);
      seedMeteorField();
      return;
    }

    if (mode === "quote") {
      let quote = pickQuote();
      if (!settings.punctuation) {
        quote = quote.replace(/[.,!?;:]/g, "");
      }
      if (settings.lowercase) {
        quote = quote.toLowerCase();
      }
      const nextWords = quote.split(/\s+/).filter(Boolean);
      promptWordsRef.current = nextWords;
      setPromptWords(nextWords);
      return;
    }

    if (mode === "code") {
      setStructuredCodePrompt(220);
      return;
    }

    const nextCount = mode === "zen" ? 260 : 220;
    const nextWords = challengeActive && dailyChallenge
      ? generateSeededWords(playPool, nextCount, dailyChallenge.seed)
      : mode === "coach"
        ? generateCoachWords(playPool, weakPatterns, nextCount)
        : takeWords(nextCount);
    promptWordsRef.current = nextWords;
    setPromptWords(nextWords);
  }

  function scheduleTypedPreview(nextValue: string) {
    pendingPreviewRef.current = nextValue;
    setTypedPreview(nextValue);
  }

  function startHudLoop() {
    const frame = (timestamp: number) => {
      const runtime = runtimeRef.current;
      if (runtime.status !== "running") return;

      if (timestamp - runtime.lastHudPaint > 70) {
        const elapsed = scoreSummary(runtime).elapsedSec;
        runSamplesRef.current.push({
          t: elapsed,
          words: runtime.completedWords,
          chars: runtime.correctChars,
        });
        if (runSamplesRef.current.length > 3000) {
          runSamplesRef.current = runSamplesRef.current.slice(-3000);
        }

        if (MODE_META[mode].timed) {
          const extraTime = mode === "rogue" ? rogueBuffsRef.current.extraTimeSec : 0;
          const remain = durationSec + extraTime - elapsed;
          setTimerText(formatSeconds(remain));
          if (remain <= 0) {
            endSession("Time up");
            return;
          }
        } else {
          setTimerText(formatSeconds(elapsed));
        }

        const ghost = ghostRuns[mode];
        if (ghost && ghost.samples.length > 0) {
          let nearest = ghost.samples[ghost.samples.length - 1] ?? ghost.samples[0]!;
          for (const sample of ghost.samples) {
            if (sample.t >= elapsed) {
              nearest = sample;
              break;
            }
          }
          const diff = runtime.correctChars - nearest.chars;
          if (Math.abs(diff) < 4) {
            setGhostStatus("Ghost pace: neck and neck");
          } else if (diff > 0) {
            setGhostStatus(`Ghost pace: +${diff} chars ahead`);
          } else {
            setGhostStatus(`Ghost pace: ${Math.abs(diff)} chars behind`);
          }
        }

        if (mode === "duel") {
          const targetWpm = Math.max(40, (ghostRuns.duel?.wpm ?? bestByMode.duel ?? 82) * (activeModeTuning.rivalPace / 100));
          const rivalChars = ((targetWpm / 60) * 5 * elapsed) * (0.96 + Math.sin(elapsed * 0.8) * 0.08);
          const rivalProgress = clamp((rivalChars / Math.max(1, runtime.correctChars + 120)) * 100, 0, 100);
          setDuelRivalProgress(rivalProgress);
        }

        if (raceRoomId && racePlayerId && timestamp - racePushAtRef.current > 450) {
          racePushAtRef.current = timestamp;
          const runtimeWpm = elapsed > 0 ? (runtime.correctChars / 5 / elapsed) * 60 : 0;
          const judged = runtime.correctChars + runtime.wrongChars;
          const runtimeAcc = judged > 0 ? (runtime.correctChars / judged) * 100 : 100;
          void updateRaceProgress({
            roomId: raceRoomId,
            playerId: racePlayerId,
            progress: computeRaceProgress(),
            wpm: runtimeWpm,
            accuracy: runtimeAcc,
            finished: false,
          }).catch(() => {
            // keep run smooth on network failures
          });
        }

        if (activeDuel && timestamp - racePushAtRef.current > 700) {
          racePushAtRef.current = timestamp;
          void pushDuelProgress(false);
        }

        updateLiveStats();
        runtime.lastHudPaint = timestamp;
      }

      runtime.hudRaf = requestAnimationFrame(frame);
    };

    runtimeRef.current.hudRaf = requestAnimationFrame(frame);
  }

  function startMeteorLoop() {
    const runtime = runtimeRef.current;
    const targetDensity = Math.round(clamp(activeModeTuning.density, 3, 7));
    if (runtime.meteorWords.length < targetDensity) {
      for (let i = runtime.meteorWords.length; i < targetDensity; i += 1) {
        spawnMeteorWord();
      }
      setMeteorWordsView([...runtime.meteorWords]);
    }

    const frame = (timestamp: number) => {
      const current = runtimeRef.current;
      if (current.status !== "running" || mode !== "meteor") return;

      if (!current.meteorLastTs) {
        current.meteorLastTs = timestamp;
      }

      const dt = clamp((timestamp - current.meteorLastTs) / 1000, 0, 0.06);
      current.meteorLastTs = timestamp;
      current.meteorSpawnClock += dt;
      const difficulty = meteorDifficulty(current);

      const spawnInterval = difficulty.spawnIntervalSec / clamp(activeModeTuning.density / 4, 0.75, 1.75);
      while (current.meteorSpawnClock >= spawnInterval) {
        spawnMeteorWord();
        current.meteorSpawnClock -= spawnInterval;
      }

      const nextWords: MeteorWord[] = [];
      let wordsChanged = false;

      for (const word of current.meteorWords) {
        const nextY = word.yPercent + word.speed * difficulty.speedScale * dt;
        if (nextY >= 96) {
          current.wrongChars += word.text.length;
          current.errors += 1;
          current.streak = 0;
          current.lives -= 1;
          wordsChanged = true;
        } else {
          nextWords.push({ ...word, yPercent: nextY });
        }
      }

      current.meteorWords = nextWords;
      if (current.meteorLockId && !current.meteorWords.some((word) => word.id === current.meteorLockId)) {
        clearMeteorSelection();
      }

      if (wordsChanged || timestamp - current.meteorLastPaint >= 42) {
        setMeteorWordsView([...current.meteorWords]);
        updateLiveStats();
        current.meteorLastPaint = timestamp;
      }

      if (current.lives <= 0) {
        endSession("Game over");
        return;
      }

      current.meteorRaf = requestAnimationFrame(frame);
    };

    runtimeRef.current.meteorRaf = requestAnimationFrame(frame);
  }

  function startSession() {
    const runtime = runtimeRef.current;
    if (runtime.status !== "idle") return;

    if (raceState && raceRoomId && racePlayerId && raceState.status === "lobby" && raceState.hostPlayerId === racePlayerId) {
      void startRaceRoom(raceRoomId, racePlayerId)
        .then((room) => setRaceState(room))
        .catch(() => {
          // host sync failure should not block local run
        });
    }

    const active = document.activeElement as HTMLElement | null;
    if (active && typeof active.blur === "function") {
      active.blur();
    }
    window.focus();
    arenaRef.current?.focus({ preventScroll: true });

    runtime.status = "running";
    runtime.startMs = performance.now();
    runtime.finishMs = 0;
    runtime.sessionId = null;
    runtime.sessionToken = null;
    runSamplesRef.current = [];
    keyEventsRef.current = [];
    keyIntervalsRef.current = [];
    lastKeyTsRef.current = performance.now();
    racePushAtRef.current = 0;
    setGhostStatus(ghostRuns[mode] ? "Ghost pace: tracking..." : "No ghost for this mode yet");
    setIsRunning(true);
    setPhase("Running");
    announce("Run started");
    setReport(null);
    trackPrivacyEvent("run_start", { page: "play", mode });

    const runNonce = runtime.runNonce;
    initSession(mode)
      .then((session) => {
        const current = runtimeRef.current;
        if (current.runNonce !== runNonce || current.status !== "running") return;
        current.sessionId = session.sessionId;
        current.sessionToken = session.token;
      })
      .catch(() => {
        // API may be offline; local play still continues.
      });

    startHudLoop();
    if (mode === "meteor") {
      startMeteorLoop();
    }
    if (raceRoomId && racePlayerId) {
      void updateRaceProgress({
        roomId: raceRoomId,
        playerId: racePlayerId,
        progress: 0,
        wpm: 0,
        accuracy: 100,
        finished: false,
      }).catch(() => {
        // ignore race sync failures
      });
    }
    void pushDuelProgress(false);
  }

  function toggleSession() {
    const runtime = runtimeRef.current;
    if (runtime.status === "running") {
      endSession("Stopped");
      return;
    }
    if (runtime.status === "finished") {
      resetSession(true);
    }
    startSession();
  }

  function endSession(reason: string) {
    const runtime = runtimeRef.current;
    if (runtime.status !== "running") return;

    runtime.status = "finished";
    setIsRunning(false);
    runtime.finishMs = performance.now();
    clearLoops();
    setPhase(reason);

    const summary = scoreSummary(runtime);
    const cpm = (runtime.rawChars / summary.elapsedSec) * 60;
    const kps = runtime.rawChars / summary.elapsedSec;
    const efficiency = runtime.rawChars > 0 ? (runtime.correctChars / runtime.rawChars) * 100 : 100;
    const best = Math.max(bestByMode[mode] ?? 0, summary.wpm);
    saveBestForMode(summary.wpm);
    announce(
      `Run ended: ${reason}. ${summary.wpm.toFixed(1)} WPM and ${summary.accuracy.toFixed(1)} percent accuracy.`,
      reason === "Game over",
    );
    trackPrivacyEvent("run_finish", { page: "play", mode });

    setReport({
      reason,
      wpm: summary.wpm,
      raw: summary.raw,
      cpm,
      kps,
      accuracy: summary.accuracy,
      efficiency,
      elapsedSec: summary.elapsedSec,
      completedWords: runtime.completedWords,
      correctChars: runtime.correctChars,
      wrongChars: runtime.wrongChars,
      maxStreak: runtime.maxStreak,
      best,
    });
    updateLiveStats();

    const ghostPayload: GhostRun = {
      mode,
      wpm: Number(summary.wpm.toFixed(2)),
      accuracy: Number(summary.accuracy.toFixed(2)),
      samples: runSamplesRef.current.slice(-1400),
      updatedAt: Date.now(),
    };
    setGhostRuns((prev) => {
      const current = prev[mode];
      if (!current || ghostPayload.wpm >= current.wpm) {
        return { ...prev, [mode]: ghostPayload };
      }
      return prev;
    });

    const replayRun: ReplayRun = {
      id: crypto.randomUUID(),
      mode,
      createdAt: new Date().toISOString(),
      durationMs: Math.round(summary.elapsedSec * 1000),
      wpm: Number(summary.wpm.toFixed(2)),
      accuracy: Number(summary.accuracy.toFixed(2)),
      events: keyEventsRef.current.slice(-5000),
      samples: runSamplesRef.current.slice(-2000),
    };
    setReplays((prev) => {
      const next = [replayRun, ...prev].slice(0, 20);
      if (!selectedReplayId) {
        setSelectedReplayId(replayRun.id);
      }
      return next;
    });

    const intervals = keyIntervalsRef.current;
    const avgInterval =
      intervals.length > 0 ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : 120;
    const minInterval = intervals.length > 0 ? Math.min(...intervals) : avgInterval;
    const idleCount = intervals.filter((value) => value >= 800).length;
    const idleRatio = intervals.length > 0 ? idleCount / intervals.length : 0;
    const telemetry = {
      typedChars: runtime.rawChars,
      correctChars: runtime.correctChars,
      wrongChars: runtime.wrongChars,
      avgKeyIntervalMs: Number(avgInterval.toFixed(2)),
      burstKps: Number((1000 / Math.max(8, minInterval)).toFixed(2)),
      idleRatio: Number(idleRatio.toFixed(4)),
      timelineHash: simpleHash64(JSON.stringify(keyEventsRef.current.slice(-2000))),
    };

    if (runtime.sessionId && runtime.sessionToken) {
      const scorePayload = {
        sessionId: runtime.sessionId,
        mode,
        username: accountProfile?.handle?.trim() || authHandle.trim() || username.trim() || raceName.trim() || "guest",
        wpm: Number(summary.wpm.toFixed(2)),
        raw: Number(summary.raw.toFixed(2)),
        accuracy: Number(summary.accuracy.toFixed(2)),
        errors: runtime.errors,
        streak: runtime.maxStreak,
        durationMs: Math.round(summary.elapsedSec * 1000),
        certified: certifiedRun,
      };

      const challengeEligible =
        challengeActive &&
        dailyChallenge &&
        mode === dailyChallenge.mode &&
        Math.abs(scorePayload.durationMs - dailyChallenge.durationSec * 1000) <= 15_000;

      if (challengeEligible) {
        submitChallengeScore(
          {
            ...scorePayload,
            challengeDate: dailyChallenge.date,
          },
          runtime.sessionToken,
          accountToken || undefined,
        )
          .then((result) => {
            setChallengeNote(`Challenge submitted: +${result.points} pts`);
            announce(`Challenge submitted. ${result.points} points awarded.`);
            void refreshChallengeAndSeason(true);
          })
          .catch((error) => {
            setChallengeNote(`Challenge submit failed: ${(error as Error).message}`);
            announce("Challenge submission failed.", true);
          });
      } else {
        submitScore(
          {
            ...scorePayload,
            clientVersion: "react-creative-v2",
            telemetry,
          },
          runtime.sessionToken,
          accountToken || undefined,
        )
          .then(() => refreshLeaderboard(true))
          .catch(() => {
            // Keep local gameplay unaffected if leaderboard submit fails.
          });
      }
    }

    if (raceRoomId && racePlayerId) {
      void updateRaceProgress({
        roomId: raceRoomId,
        playerId: racePlayerId,
        progress: 100,
        wpm: summary.wpm,
        accuracy: summary.accuracy,
        finished: true,
      }).catch(() => {
        // ignore race sync failures
      });
    }
    void pushDuelProgress(true);
  }

  function commitCurrentWord() {
    const typed = typedRef.current.trim();
    if (!typed) return;
    if (runtimeRef.current.status === "idle") {
      startSession();
    }

    const words = promptWordsRef.current;
    const index = currentIndexRef.current;
    const isEchoRecall = mode === "echo" && echoPendingRef.current !== null;
    const target = isEchoRecall ? echoPendingRef.current ?? words[index] : words[index];
    if (!target) return;
    const isInfectedWord = infectedIndices.includes(index);

    const runtime = runtimeRef.current;
    const snapshot: SubmittedWordSnapshot = {
      index,
      typed,
      result: wordResults[index],
      correctChars: runtime.correctChars,
      wrongChars: runtime.wrongChars,
      rawChars: runtime.rawChars,
      errors: runtime.errors,
      streak: runtime.streak,
      maxStreak: runtime.maxStreak,
      completedWords: runtime.completedWords,
      chainCombo,
      infectedIndices: [...infectedIndices],
      echoPending: echoPendingRef.current,
    };
    const result = compareWords(typed, target);
    runtime.correctChars += result.correct;
    runtime.wrongChars += result.wrong;
    runtime.rawChars += typed.length;
    logReplayEvent("submit", "submit", typed === target);

    const perfect = typed === target;
    submittedHistoryRef.current = [...submittedHistoryRef.current.slice(-24), snapshot];
    if (perfect) {
      runtime.completedWords += 1;
      let keepStreak = true;
      if (mode === "pulse" || mode === "duel" || mode === "chart") {
        const timing = pulseTiming(runtime, pulseBpm);
        const strictnessScale = clamp(1.3 - activeModeTuning.strictness * 0.12, 0.62, 1.18);
        const perfectWindow = (mode === "chart" ? 0.04 : 0.055) * strictnessScale;
        const greatWindow = (mode === "chart" ? 0.08 : 0.11) * strictnessScale;
        const okWindow = (mode === "chart" ? 0.14 : 0.18) * strictnessScale;
        if (timing.distanceSec <= perfectWindow) {
          runtime.correctChars += Math.max(2, Math.floor(target.length * 0.9));
          showPulseJudge(
            mode === "duel" ? "PERFECT STRIKE" : mode === "chart" ? "CRIT HIT" : "PERFECT BEAT",
            "perfect",
          );
        } else if (timing.distanceSec <= greatWindow) {
          runtime.correctChars += Math.max(1, Math.floor(target.length * 0.55));
          showPulseJudge(
            mode === "duel" ? "GREAT STRIKE" : mode === "chart" ? "GOOD HIT" : "GREAT BEAT",
            "great",
          );
        } else if (timing.distanceSec <= okWindow) {
          runtime.correctChars += 1;
          showPulseJudge(mode === "duel" ? "HIT" : mode === "chart" ? "LATE" : "ON BEAT", "ok");
        } else {
          runtime.wrongChars += 1;
          runtime.errors += 1;
          keepStreak = false;
          showPulseJudge(mode === "duel" ? "DODGED" : mode === "chart" ? "MISS" : "OFF BEAT", "miss");
        }
      }
      if (mode === "rogue") {
        const buffs = rogueBuffsRef.current;
        runtime.correctChars += Math.floor(target.length * Math.max(0, buffs.scoreMultiplier - 1));
        if (runtime.streak >= 5 && buffs.comboBonus > 0) {
          runtime.correctChars += buffs.comboBonus;
        }
      }
      if (keepStreak) {
        runtime.streak += 1;
        runtime.maxStreak = Math.max(runtime.maxStreak, runtime.streak);
      } else {
        runtime.streak = 0;
      }
      if (mode === "chain") {
        const nextCombo = Math.min(18, chainCombo + 1);
        runtime.correctChars += Math.max(0, nextCombo - 1);
        setChainCombo(nextCombo);
      }
      if (mode === "infection" && isInfectedWord) {
        setInfectedIndices((prev) => prev.filter((value) => value !== index));
      }
      if (mode === "coop") {
        const teamSize = Math.round(clamp(activeModeTuning.teamSize, 2, 4));
        setCoopTurn((prev) => (prev >= teamSize ? 1 : prev + 1));
      }
    } else {
      let ignoreError = false;
      if (mode === "rogue" && rogueBuffsRef.current.shieldCharges > 0) {
        rogueBuffsRef.current = {
          ...rogueBuffsRef.current,
          shieldCharges: rogueBuffsRef.current.shieldCharges - 1,
        };
        ignoreError = true;
      }
      if (!ignoreError) {
        runtime.errors += 1;
        runtime.streak = 0;
        if (mode === "rogue") {
          runtime.wrongChars += Math.ceil(result.wrong * (rogueBuffsRef.current.wrongPenaltyScale - 1));
        }
        if (mode === "infection" && isInfectedWord) {
          runtime.wrongChars += 2;
          runtime.errors += 1;
        }
      }
      pushWeakness(target, typed);
      if (mode === "pulse" || mode === "duel" || mode === "chart") {
        showPulseJudge("MISS", "miss");
      }
      if (mode === "chain") {
        setChainCombo(1);
      }
      if (mode === "infection") {
        setInfectedIndices((prev) => {
          const next = new Set(prev);
          const spread = Math.round(clamp(activeModeTuning.spread, 1, 4));
          for (let offset = 1; offset <= spread; offset += 1) {
            next.add(index + offset);
          }
          return [...next].filter((value) => value < words.length + 500);
        });
      }
    }

    if (!isEchoRecall) {
      setWordResults((prev) => {
        const next = [...prev];
        next[index] = perfect ? "good" : "bad";
        return next;
      });
    }

    if (mode === "relay" && !perfect) {
      const rollbackIndex = Math.max(0, index - Math.round(clamp(activeModeTuning.spread, 1, 4)));
      currentIndexRef.current = rollbackIndex;
      setCurrentIndex(rollbackIndex);
      clearInput();
      updateLiveStats();
      return;
    }

    let nextIndex = index + 1;
    if (mode === "echo") {
      if (isEchoRecall) {
        echoPendingRef.current = null;
        setEchoPending(null);
        nextIndex = index;
      } else {
        echoPendingRef.current = perfect ? target : null;
        setEchoPending(perfect ? target : null);
      }
    }
    currentIndexRef.current = nextIndex;
    setCurrentIndex(nextIndex);

    if (
      mode === "rogue" &&
      perfect &&
      runtime.completedWords > 0 &&
      runtime.completedWords % Math.round(clamp(activeModeTuning.perkEvery, 8, 30)) === 0
    ) {
      const offers = rogueOffers();
      setRogueOffer(offers);
      showPulseJudge("PICK A PERK (1-3)", "ok");
    }

    if (mode !== "quote" && nextIndex >= words.length - 50) {
      setPromptWords((prev) => {
        const next = mode === "code" ? appendStructuredCodePrompt(prev, 80) : [...prev, ...takeWords(80)];
        promptWordsRef.current = next;
        return next;
      });
    }

    if (mode === "quote" && nextIndex >= words.length) {
      clearInput();
      endSession("Done");
      return;
    }

    clearInput();
    updateLiveStats();
  }

  function undoSubmittedWord() {
    const snapshot = submittedHistoryRef.current.pop();
    if (!snapshot || runtimeRef.current.status === "finished") {
      return false;
    }
    const runtime = runtimeRef.current;
    runtime.correctChars = snapshot.correctChars;
    runtime.wrongChars = snapshot.wrongChars;
    runtime.rawChars = snapshot.rawChars;
    runtime.errors = snapshot.errors;
    runtime.streak = snapshot.streak;
    runtime.maxStreak = snapshot.maxStreak;
    runtime.completedWords = snapshot.completedWords;
    currentIndexRef.current = snapshot.index;
    setCurrentIndex(snapshot.index);
    typedRef.current = snapshot.typed;
    pendingPreviewRef.current = snapshot.typed;
    setTypedPreview(snapshot.typed);
    setWordResults((prev) => {
      const next = [...prev];
      if (snapshot.result == null) {
        delete next[snapshot.index];
      } else {
        next[snapshot.index] = snapshot.result;
      }
      return next;
    });
    echoPendingRef.current = snapshot.echoPending;
    setEchoPending(snapshot.echoPending);
    setInfectedIndices(snapshot.infectedIndices);
    setChainCombo(snapshot.chainCombo);
    logReplayEvent("backspace", "Undo submit", true);
    updateLiveStats();
    return true;
  }

  function clearInput() {
    typedRef.current = "";
    pendingPreviewRef.current = "";
    setTypedPreview("");
  }

  function handleStandardKey(event: globalThis.KeyboardEvent) {
    if (mode === "meteor") return;
    if (isEditableElement(event.target)) return;
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;

    const runtime = runtimeRef.current;

    if (event.key === "Escape") {
      event.preventDefault();
      resetSession(false);
      return;
    }

    if (mode === "rogue" && rogueOffer) {
      if (event.key === "1" || event.key === "2" || event.key === "3") {
        event.preventDefault();
        applyRogueOffer(Number(event.key) - 1);
      }
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      if (runtime.status === "finished") {
        return;
      }
      if (typedRef.current.length > 0) {
        typedRef.current = typedRef.current.slice(0, -1);
        scheduleTypedPreview(typedRef.current);
        logReplayEvent("backspace", "Backspace", true);
      } else {
        undoSubmittedWord();
      }
      return;
    }

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (runtime.status === "finished") {
        return;
      }
      commitCurrentWord();
      return;
    }

    if (event.key.length !== 1) return;
    const allowedKey =
      mode === "code"
        ? /^[a-zA-Z0-9.,!?;:'"`$()[\]{}<>+=*/_-]$/.test(event.key)
        : /^[a-zA-Z0-9.,!?;:'"-]$/.test(event.key);
    if (!allowedKey) return;

    if (runtime.status === "finished") {
      resetSession(false);
    }

    noteKeyInterval();
    const inputChar = settings.lowercase ? event.key.toLowerCase() : event.key;
    const expectedWord =
      mode === "echo" && echoPendingRef.current ? echoPendingRef.current : promptWordsRef.current[currentIndexRef.current];
    const expectedChar = expectedWord?.[typedRef.current.length];
    const charCorrect =
      expectedChar != null ? expectedChar.toLowerCase() === inputChar.toLowerCase() : false;
    bumpKeyStat(inputChar, charCorrect);
    logReplayEvent("key", inputChar, charCorrect);
    typedRef.current += inputChar;
    scheduleTypedPreview(typedRef.current);

    if (runtime.status === "idle" && typedRef.current.length > 0) {
      startSession();
    }
  }

  function handleMeteorKey(event: globalThis.KeyboardEvent) {
    if (mode !== "meteor") return;
    if (isEditableElement(event.target)) return;
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;

    const runtime = runtimeRef.current;
    if (runtime.status === "finished") {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      resetSession(false);
      return;
    }

    if (event.key === " ") {
      event.preventDefault();
      logReplayEvent("submit", "Space", true);
      if (runtime.meteorLockId && runtime.meteorBuffer.length > 0) {
        const index = runtime.meteorWords.findIndex((word) => word.id === runtime.meteorLockId);
        if (index >= 0) {
          const target = runtime.meteorWords[index];
          if (!target) {
            return;
          }
          const chip = Math.min(runtime.meteorBuffer.length, target.text.length);
          const remaining = target.text.slice(chip);
          runtime.correctChars += chip;

          if (remaining.length > 0) {
            runtime.meteorWords[index] = { ...target, text: remaining };
          } else {
            runtime.completedWords += 1;
            runtime.streak += 1;
            runtime.maxStreak = Math.max(runtime.maxStreak, runtime.streak);
            runtime.meteorWords = runtime.meteorWords.filter((word) => word.id !== target.id);
            triggerExplosion(target);
            if (runtime.meteorWords.length < Math.round(clamp(activeModeTuning.density, 3, 7))) {
              spawnMeteorWord();
            }
          }
          setMeteorWordsView([...runtime.meteorWords]);
          updateLiveStats();
        }
      }
      clearMeteorSelection();
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      if (runtime.meteorBuffer.length > 0) {
        runtime.meteorBuffer = runtime.meteorBuffer.slice(0, -1);
        if (runtime.meteorBuffer.length === 0) {
          runtime.meteorLockId = null;
        } else {
          const nextLock = chooseMeteorTarget(runtime.meteorWords, runtime.meteorBuffer, runtime.meteorLockId);
          runtime.meteorLockId = nextLock?.id ?? null;
        }
        syncMeteorSelection();
        logReplayEvent("backspace", "Backspace", true);
      }
      return;
    }

    if (event.key.length !== 1) return;
    if (!/^[a-zA-Z0-9.,!?;:]$/.test(event.key)) return;

    const inputChar = settings.lowercase ? event.key.toLowerCase() : event.key;

    if (runtime.status === "idle") {
      startSession();
    }

    event.preventDefault();
    noteKeyInterval();
    runtime.rawChars += 1;

    const nextBuffer = `${runtime.meteorBuffer}${inputChar}`;
    const lockWord = chooseMeteorTarget(runtime.meteorWords, nextBuffer, runtime.meteorLockId);

    if (lockWord) {
      const switchedTarget = runtime.meteorLockId !== lockWord.id;
      runtime.meteorLockId = lockWord.id;
      if (switchedTarget) {
        playLockSfx();
      }
      bumpKeyStat(inputChar, true);
      logReplayEvent("key", inputChar, true);
      triggerLaser(lockWord);
      runtime.meteorBuffer = nextBuffer;
      if (runtime.meteorBuffer.length >= lockWord.text.length) {
        runtime.correctChars += lockWord.text.length;
        runtime.completedWords += 1;
        runtime.streak += 1;
        runtime.maxStreak = Math.max(runtime.maxStreak, runtime.streak);
        runtime.meteorWords = runtime.meteorWords.filter((word) => word.id !== lockWord.id);
        triggerExplosion(lockWord);
        runtime.meteorLockId = null;
        runtime.meteorBuffer = "";
        if (runtime.meteorWords.length < Math.round(clamp(activeModeTuning.density, 3, 7))) {
          spawnMeteorWord();
        }
        setMeteorWordsView([...runtime.meteorWords]);
      }
    } else {
      bumpKeyStat(inputChar, false);
      logReplayEvent("miss", inputChar, false);
      runtime.wrongChars += 1;
      runtime.errors += 1;
      runtime.streak = 0;
    }

    syncMeteorSelection();
    updateLiveStats();
  }

  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => {
      if (appRoute !== "play" || !modeFromPathname(pathname || "/")) {
        return;
      }
      if (mode === "meteor") {
        handleMeteorKey(event);
      } else {
        handleStandardKey(event);
      }
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, [appRoute, mode, pathname, settings.lowercase, pulseBpm, focusPrefs.sfxEnabled, rogueOffer, soundPack]);

  function saveCustomDictionary() {
    const words = splitCustomWords(customInput);
    setCustomWords(words);
    localStorage.setItem(STORAGE_CUSTOM, JSON.stringify(words));
    resetSession(true);
  }

  useEffect(() => {
    if (!replayPlaying) {
      return;
    }
    const replay = replays.find((item) => item.id === selectedReplayId);
    if (!replay) {
      return;
    }
    const id = window.setInterval(() => {
      setReplayCursorMs((prev) => {
        const next = prev + 120;
        if (next >= replay.durationMs) {
          setReplayPlaying(false);
          return replay.durationMs;
        }
        return next;
      });
    }, 120);
    return () => {
      window.clearInterval(id);
    };
  }, [replayPlaying, replays, selectedReplayId]);

  useEffect(() => {
    setReplayCursorMs(0);
    setReplayPlaying(false);
  }, [selectedReplayId]);

  const lockedMeteorWord =
    meteorSelection.id != null ? meteorWordsView.find((word) => word.id === meteorSelection.id) : null;
  const shipAimDeg = lockedMeteorWord
    ? clamp(
        (Math.atan2(lockedMeteorWord.yPercent - 92, lockedMeteorWord.xPercent - 50) * 180) / Math.PI,
        -28,
        28,
      )
    : 0;
  const selectedReplay = useMemo(
    () => replays.find((item) => item.id === selectedReplayId) ?? null,
    [replays, selectedReplayId],
  );
  const replayVisibleEvents = useMemo(
    () =>
      selectedReplay
        ? selectedReplay.events.filter((event) => event.t <= replayCursorMs).slice(-28)
        : ([] as ReplayEvent[]),
    [selectedReplay, replayCursorMs],
  );

  function normalizeReplayCandidate(raw: unknown): ReplayRun | null {
    const record = asRecord(raw);
    if (!record) return null;

    const modeValue = record.mode;
    const allowedModes = new Set<Mode>([
      "time",
      "quote",
      "meteor",
      "zen",
      "pulse",
      "relay",
      "cipher",
      "drift",
      "reverse",
      "echo",
      "rogue",
      "duel",
    ]);
    if (typeof modeValue !== "string" || !allowedModes.has(modeValue as Mode)) {
      return null;
    }

    const eventsRaw = Array.isArray(record.events) ? record.events : [];
    const events: ReplayEvent[] = eventsRaw
      .map((item) => {
        const eventRecord = asRecord(item);
        if (!eventRecord) return null;
        const t = Number(eventRecord.t);
        const key = `${eventRecord.key ?? ""}`.slice(0, 32);
        const kind = eventRecord.kind;
        const correct = Boolean(eventRecord.correct);
        if (
          !Number.isFinite(t) ||
          typeof kind !== "string" ||
          !["key", "submit", "backspace", "miss", "mode"].includes(kind)
        ) {
          return null;
        }
        return { t: Math.max(0, t), key, kind: kind as ReplayEvent["kind"], correct };
      })
      .filter((value): value is ReplayEvent => value !== null)
      .slice(0, 6000);

    const samplesRaw = Array.isArray(record.samples) ? record.samples : [];
    const samples = samplesRaw
      .map((item) => {
        const sampleRecord = asRecord(item);
        if (!sampleRecord) return null;
        const t = Number(sampleRecord.t);
        const words = Number(sampleRecord.words);
        const chars = Number(sampleRecord.chars);
        if (!Number.isFinite(t) || !Number.isFinite(words) || !Number.isFinite(chars)) {
          return null;
        }
        return {
          t: Math.max(0, t),
          words: Math.max(0, Math.round(words)),
          chars: Math.max(0, Math.round(chars)),
        };
      })
      .filter((value): value is { t: number; words: number; chars: number } => value !== null)
      .slice(0, 4000);

    const createdAt =
      typeof record.createdAt === "string" && Number.isFinite(Date.parse(record.createdAt))
        ? record.createdAt
        : new Date().toISOString();

    return {
      id: typeof record.id === "string" && record.id.length > 0 ? record.id : crypto.randomUUID(),
      mode: modeValue as Mode,
      createdAt,
      durationMs: Math.max(0, Math.round(Number(record.durationMs) || 0)),
      wpm: Number(Number(record.wpm) || 0),
      accuracy: Number(Number(record.accuracy) || 0),
      events,
      samples,
    };
  }

  function exportSelectedReplayFile(): void {
    if (!selectedReplay) {
      return;
    }
    const filenameDate = selectedReplay.createdAt.replace(/[:.]/g, "-");
    const blob = new Blob([JSON.stringify(selectedReplay, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `typeshift-replay-${selectedReplay.mode}-${filenameDate}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setReplayNote("Replay exported.");
  }

  async function importReplayFile(file?: File): Promise<void> {
    if (!file) {
      return;
    }
    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText) as unknown;
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      const normalized = candidates
        .map((candidate) => normalizeReplayCandidate(candidate))
        .filter((value): value is ReplayRun => value !== null);
      if (normalized.length === 0) {
        setReplayNote("Replay import failed: file had no valid replay data.");
        return;
      }
      setReplays((prev) => {
        const dedup = new Map<string, ReplayRun>();
        for (const replay of [...normalized, ...prev]) {
          dedup.set(replay.id, replay);
        }
        return [...dedup.values()].slice(0, 20);
      });
      setSelectedReplayId(normalized[0]?.id ?? "");
      setReplayNote(`Imported ${normalized.length} replay file${normalized.length > 1 ? "s" : ""}.`);
    } catch (_error) {
      setReplayNote("Replay import failed: invalid JSON file.");
    }
  }

  const fingerStats = useMemo(() => {
    const summary: Record<string, { hits: number; errors: number }> = {};
    for (const [key, bucket] of Object.entries(keyStats)) {
      const finger = KEY_TO_FINGER[key] ?? "Unknown";
      const current = summary[finger] ?? { hits: 0, errors: 0 };
      summary[finger] = {
        hits: current.hits + bucket.hits,
        errors: current.errors + bucket.errors,
      };
    }
    return Object.entries(summary)
      .map(([finger, bucket]) => ({
        finger,
        hits: bucket.hits,
        errors: bucket.errors,
        accuracy: bucket.hits > 0 ? ((bucket.hits - bucket.errors) / bucket.hits) * 100 : 100,
      }))
      .sort((a, b) => a.finger.localeCompare(b.finger));
  }, [keyStats]);

  const statCards = useMemo(
    () => [
      {
        key: "wpm",
        label: "WPM",
        value: stats.wpm.toFixed(1),
        help: "Words per minute based on correct characters. Five characters count as one word.",
      },
      {
        key: "raw",
        label: "RAW",
        value: stats.raw.toFixed(1),
        help: "Raw speed using all typed characters, including mistakes.",
      },
      {
        key: "cpm",
        label: "CPM",
        value: stats.cpm.toFixed(0),
        help: "Characters per minute, including both correct and wrong keys.",
      },
      {
        key: "kps",
        label: "KPS",
        value: stats.kps.toFixed(2),
        help: "Keystrokes per second.",
      },
      {
        key: "acc",
        label: "ACC",
        value: `${stats.accuracy.toFixed(1)}%`,
        help: "Correct characters divided by total judged characters.",
      },
      {
        key: "eff",
        label: "EFF",
        value: `${stats.efficiency.toFixed(1)}%`,
        help: "Correct characters divided by all typed characters.",
      },
      {
        key: "words",
        label: "WORDS",
        value: String(stats.completedWords),
        help: "Total words completed in this run.",
      },
      {
        key: "correct",
        label: "CORRECT",
        value: String(stats.correctChars),
        help: "Number of correct characters entered.",
      },
      {
        key: "wrong",
        label: "WRONG",
        value: String(stats.wrongChars),
        help: "Number of wrong characters entered.",
      },
      {
        key: "errors",
        label: "ERRORS",
        value: String(stats.errors),
        help: "Mistakes counted at word-level and mode-level events.",
      },
      {
        key: "streak",
        label: "STREAK",
        value: String(stats.streak),
        help: "Current chain of completed words without a reset.",
      },
      {
        key: "bestStreak",
        label: "BEST STREAK",
        value: String(stats.maxStreak),
        help: "Highest streak reached in this run.",
      },
      {
        key: "time",
        label: "TIME",
        value: formatSeconds(stats.elapsedSec),
        help: "Elapsed run time.",
      },
      {
        key: "lives",
        label: "LIVES",
        value: mode === "meteor" ? String(stats.lives) : "-",
        help: "Remaining lives in Meteor mode.",
      },
    ],
    [mode, stats],
  );

  const focusStatCards = useMemo(
    () => statCards.filter((card) => focusPrefs.statVisibility[card.key]),
    [focusPrefs.statVisibility, statCards],
  );
  const previewMode = modePreview ?? mode;
  const profileSubroute = profileSubrouteFromPathname(pathname || "/");
  useEffect(() => {
    if (appRoute !== "profile" || profileSubroute !== "admin") {
      return;
    }
    if (!isAnalyticsAdmin || !accountToken) {
      setAdminUsers([]);
      setAdminLeaderboardRows([]);
      return;
    }
    void refreshAdminUsers();
    void refreshAdminLeaderboardRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountToken, appRoute, isAnalyticsAdmin, profileSubroute]);
  const runIndicatorCards = [
    { key: "mode", label: "Mode", value: MODE_META[mode].label },
    { key: "pack", label: "Pack", value: dictionaryPack.toUpperCase() },
    { key: "acc", label: "Acc", value: `${stats.accuracy.toFixed(1)}%` },
    { key: "streak", label: "Streak", value: String(stats.streak) },
    {
      key: "tempo",
      label: mode === "cipher" ? "Shift" : mode === "pulse" || mode === "duel" || mode === "chart" ? "BPM" : "State",
      value:
        mode === "cipher"
          ? `${cipherDirection === "forward" ? "+" : "-"}${cipherShift}`
          : mode === "pulse" || mode === "duel" || mode === "chart"
            ? String(pulseBpm)
            : phase,
    },
  ];
  const playModeCards = GAME_MODES.map((modeId) => ({
    id: modeId,
    label: MODE_META[modeId].label,
    flavor: MODE_META[modeId].flavor,
    detail: MODE_DETAILS[modeId],
    family: MODE_META[modeId].family,
    difficulty: MODE_META[modeId].difficulty,
    rule: MODE_META[modeId].rule,
    recommended: MODE_META[modeId].recommended,
    best: (bestByMode[modeId] ?? 0).toFixed(1),
  }));

  const selectedGameMode = modeFromPathname(pathname || "/");
  const activeModeMeta = MODE_META[mode];
  const showDistrictStack = appRoute === "settings";
  const showArena = appRoute === "play" && selectedGameMode !== null;
  const atlasLayoutClass = showArena
    ? "atlas-layout atlas-layout--play"
    : showDistrictStack
      ? "atlas-layout atlas-layout--duo"
      : "atlas-layout atlas-layout--single";
  const focusModeActive = showArena && isRunning && focusPrefs.enabled;
  const cipherSignedShift = cipherDirection === "forward" ? cipherShift : -cipherShift;
  const gravityFlip =
    mode === "gravity" &&
    Math.floor(stats.elapsedSec / Math.max(2, activeModeTuning.intervalSec)) % 2 === 1;
  const pulseState =
    mode === "pulse" || mode === "duel" || mode === "chart"
      ? pulseTiming(runtimeRef.current, pulseBpm)
      : { phase: 0, quality: "miss" as PulseJudgeTone };

  return (
    <div className={`scene-root ${focusModeActive ? "game-focus" : ""}`}>
      <a className="skip-link" href={showArena ? "#typing-arena" : "#main-content"}>
        {showArena ? "Skip to typing arena" : "Skip to main content"}
      </a>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {liveAlertMessage}
      </div>

      <header className="site-header">
        <BrandLogo href={pathForRoute("home")} />
        <nav className="site-nav" aria-label="Main sections">
          {ROUTE_GROUPS.map((group) => (
            <div key={group.label} className="site-nav-group">
              {group.routes.map((route) => (
                <Link
                  key={route}
                  href={pathForRoute(route)}
                  className={`site-nav-link ${
                    appRoute === route || (route === "settings" && (appRoute === "profile" || appRoute === "privacy"))
                      ? "active"
                      : ""
                  }`}
                  aria-current={
                    appRoute === route || (route === "settings" && (appRoute === "profile" || appRoute === "privacy"))
                      ? "page"
                      : undefined
                  }
                >
                  <span className="site-nav-label">{ROUTE_LABELS[route]}</span>
                  <span className="site-nav-hint sr-only">{ROUTE_COPY[route].title}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="site-tools">
          <button
            className="theme-toggle"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            aria-pressed={theme === "dark"}
            aria-label="Toggle theme"
            title={theme === "dark" ? "Light theme" : "Dark theme"}
          >
            <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
          </button>
          {accountProfile ? (
            <button className="auth-chip signed-in" onClick={() => void logoutCurrentAccountFlow()}>
              <strong>Log out</strong>
            </button>
          ) : (
            <Link href={pathForProfileSubroute("account")} className="auth-chip guest">
              <strong>Sign in</strong>
            </Link>
          )}
        </div>
      </header>

      <main className={atlasLayoutClass} id="main-content">
        {appRoute === "play" && !showArena && (
          <section className="games-library" aria-labelledby="games-title">
            <div className="games-library-head">
              <h1 id="games-title">Typing games</h1>
              <p>Choose a typing game or practice mode. Each opens in its own focused play space.</p>
            </div>
            <div className="games-grid">
              {playModeCards.map((entry) => (
                <Link
                  key={entry.id}
                  href={pathForMode(entry.id)}
                  className={`game-library-card game-library-card--${entry.id} game-library-card--${entry.family}`}
                >
                  <span className="game-card-glyph" aria-hidden="true">{MODE_GLYPHS[entry.id]}</span>
                  <span className="game-card-copy">
                    <span className="game-card-kicker">
                      {entry.family} · {entry.difficulty}
                    </span>
                    <strong>{entry.label}</strong>
                    <span>{entry.flavor}</span>
                    <small>{entry.rule}</small>
                    <em>{entry.recommended.durationSec}s · {entry.recommended.pack}</em>
                  </span>
                  <span className="game-card-arrow" aria-hidden="true">→</span>
                </Link>
              ))}
            </div>
          </section>
        )}
        {showDistrictStack && (
          <aside className="district-stack">
            {appRoute === "settings" && (
              <p className="dictionary-note">
                Settings hub: tune run setup, accessibility, sound, and focus HUD from this page.
              </p>
            )}

            <section className="settings-card">
              <h3>Run setup</h3>
              <label>
                Duration
                <select value={durationSec} onChange={(e) => setDurationSec(Number(e.target.value))}>
                  <option value={30}>30s</option>
                  <option value={60}>60s</option>
                  <option value={90}>90s</option>
                  <option value={120}>120s</option>
                </select>
              </label>
              <label>
                Word set
                <select
                  value={dictionaryPack}
                  onChange={(e) => setDictionaryPack(e.target.value as DictionaryPack)}
                >
                  <option value="core">Core</option>
                  <option value="tech">Tech</option>
                  <option value="myth">Mythic</option>
                  <option value="blitz">Blitz</option>
                  <option value="top1k">Top 1K</option>
                  <option value="top5k">Top 5K</option>
                  <option value="top10k">Top 10K</option>
                  <option value="verbs">Verbs</option>
                  <option value="nouns">Nouns</option>
                  <option value="code">Code</option>
                  <option value="spanish">Spanish</option>
                  <option value="french">French</option>
                  <option value="german">German</option>
                </select>
              </label>
              <div className="toggle-grid">
                <button
                  type="button"
                  className={`toggle-pill ${settings.punctuation ? "active" : ""}`}
                  aria-pressed={settings.punctuation}
                  onClick={() => setSettings((s) => ({ ...s, punctuation: !s.punctuation }))}
                >
                  Punctuation
                </button>
                <button
                  type="button"
                  className={`toggle-pill ${settings.numbers ? "active" : ""}`}
                  aria-pressed={settings.numbers}
                  onClick={() => setSettings((s) => ({ ...s, numbers: !s.numbers }))}
                >
                  Numbers
                </button>
                <button
                  type="button"
                  className={`toggle-pill ${settings.lowercase ? "active" : ""}`}
                  aria-pressed={settings.lowercase}
                  onClick={() => setSettings((s) => ({ ...s, lowercase: !s.lowercase }))}
                >
                  Lowercase lock
                </button>
                <button
                  type="button"
                  className={`toggle-pill ${settings.customOnly ? "active" : ""}`}
                  aria-pressed={settings.customOnly}
                  onClick={() => setSettings((s) => ({ ...s, customOnly: !s.customOnly }))}
                >
                  Custom only
                </button>
              </div>
              <p className="dictionary-note">{dictionaryStatus}</p>
              {mode === "cipher" && (
                <div className="mode-options">
                  <h4>Cipher Settings</h4>
                  <label>
                    Shift direction
                    <select
                      value={cipherDirection}
                      onChange={(event) => setCipherDirection(event.target.value as CipherDirection)}
                    >
                      <option value="forward">Forward</option>
                      <option value="backward">Backward</option>
                    </select>
                  </label>
                  <label>
                    Letter shift
                    <input
                      type="range"
                      min={1}
                      max={25}
                      value={cipherShift}
                      onChange={(event) => setCipherShift(clamp(Number(event.target.value), 1, 25))}
                    />
                  </label>
                  <p className="dictionary-note">
                    Global shift: {cipherDirection === "forward" ? "+" : "-"}
                    {cipherShift}
                  </p>
                </div>
              )}
              {(mode === "pulse" || mode === "duel" || mode === "chart") && (
                <div className="mode-options">
                  <h4>Rhythm Settings</h4>
                  <label>
                    BPM
                    <input
                      type="range"
                      min={70}
                      max={180}
                      step={1}
                      value={pulseBpm}
                      onChange={(event) => setPulseBpm(clamp(Number(event.target.value), 70, 180))}
                    />
                  </label>
                  <p className="dictionary-note">Beat speed: {pulseBpm} BPM</p>
                </div>
              )}
              <div className="mode-options">
                <h4>Training + Access</h4>
                <label className="inline-toggle">
                  <input
                    type="checkbox"
                    checked={adaptiveTrainer}
                    onChange={(event) => setAdaptiveTrainer(event.target.checked)}
                  />
                  Adaptive weak-pattern trainer
                </label>
                <label className="inline-toggle">
                  <input
                    type="checkbox"
                    checked={certifiedRun}
                    onChange={(event) => setCertifiedRun(event.target.checked)}
                  />
                  Certified run mode
                </label>
                <label>
                  Sound pack
                  <select value={soundPack} onChange={(event) => setSoundPack(event.target.value as SoundPack)}>
                    <option value="arcade">Arcade</option>
                    <option value="retro">Retro</option>
                    <option value="cinematic">Cinematic</option>
                    <option value="soft">Soft</option>
                    <option value="mute">Mute</option>
                  </select>
                </label>
                <label className="inline-toggle">
                  <input
                    type="checkbox"
                    checked={focusPrefs.sfxEnabled}
                    onChange={(event) =>
                      setFocusPrefs((prev) => ({
                        ...prev,
                        sfxEnabled: event.target.checked,
                      }))
                    }
                  />
                  Sound effects
                </label>
                <label className="inline-toggle">
                  <input
                    type="checkbox"
                    checked={focusPrefs.musicEnabled}
                    onChange={(event) =>
                      setFocusPrefs((prev) => ({
                        ...prev,
                        musicEnabled: event.target.checked,
                      }))
                    }
                  />
                  Background music
                </label>
                <label>
                  SFX level
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={focusPrefs.sfxVolume}
                    onChange={(event) =>
                      setFocusPrefs((prev) => ({
                        ...prev,
                        sfxVolume: clamp(Number(event.target.value), 0, 1),
                      }))
                    }
                  />
                </label>
                <label>
                  Music level
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={focusPrefs.musicVolume}
                    onChange={(event) =>
                      setFocusPrefs((prev) => ({
                        ...prev,
                        musicVolume: clamp(Number(event.target.value), 0, 1),
                      }))
                    }
                  />
                </label>
                <label>
                  Accessibility preset
                  <select
                    value={accessibilityPreset}
                    onChange={(event) => setAccessibilityPreset(event.target.value as AccessibilityPreset)}
                  >
                    <option value="standard">Standard</option>
                    <option value="reduced">Reduced motion</option>
                    <option value="contrast">High contrast</option>
                    <option value="colorblind">Colorblind friendly</option>
                    <option value="dyslexia">Dyslexia support</option>
                  </select>
                </label>
                {weakPatterns.length > 0 && (
                  <p className="dictionary-note">Weak patterns: {weakPatterns.slice(0, 6).join(", ")}</p>
                )}
                <label className="inline-toggle">
                  <input
                    type="checkbox"
                    checked={accessibilityPrefs.announceEvents}
                    onChange={(event) =>
                      setAccessibilityPrefs((prev) => ({ ...prev, announceEvents: event.target.checked }))
                    }
                  />
                  Announce key events
                </label>
                <label>
                  Text scale
                  <input
                    type="range"
                    min={0.85}
                    max={1.25}
                    step={0.05}
                    value={accessibilityPrefs.textScale}
                    onChange={(event) =>
                      setAccessibilityPrefs((prev) => ({
                        ...prev,
                        textScale: clamp(Number(event.target.value), 0.85, 1.25),
                      }))
                    }
                  />
                </label>
                <p className="dictionary-note">Text scale: {(accessibilityPrefs.textScale * 100).toFixed(0)}%</p>
                <p className="dictionary-note">
                  Audio: {focusPrefs.sfxEnabled ? `${Math.round(focusPrefs.sfxVolume * 100)}% SFX` : "SFX off"} ·{" "}
                  {focusPrefs.musicEnabled ? `${Math.round(focusPrefs.musicVolume * 100)}% music` : "music off"}
                </p>
                {mode === "rogue" && <p className="dictionary-note">Active buff: {rogueBuffLabel}</p>}
              </div>
              <div className="focus-options">
                <h4>Focus Run View</h4>
                <label>
                  <input
                    type="checkbox"
                    checked={focusPrefs.enabled}
                    onChange={(event) =>
                      setFocusPrefs((prev) => ({
                        ...prev,
                        enabled: event.target.checked,
                      }))
                    }
                  />
                  Full-screen focus while running
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={focusPrefs.showStats}
                    onChange={(event) =>
                      setFocusPrefs((prev) => ({
                        ...prev,
                        showStats: event.target.checked,
                      }))
                    }
                  />
                  Keep selected stats in focus view
                </label>
                <div className="focus-stat-picker">
                  {statCards.map((card) => (
                    <label key={`focus-${card.key}`}>
                      <input
                        type="checkbox"
                        checked={focusPrefs.statVisibility[card.key] ?? false}
                        onChange={(event) =>
                          setFocusPrefs((prev) => ({
                            ...prev,
                            statVisibility: {
                              ...prev.statVisibility,
                              [card.key]: event.target.checked,
                            },
                          }))
                        }
                      />
                      {card.label}
                    </label>
                  ))}
                </div>
              </div>
            </section>
          </aside>
        )}

        {showArena && (
          <section
            className={`arena-frame arena-frame--${activeModeMeta.family} arena-frame--mode-${mode}`}
            id="typing-arena"
            ref={arenaRef}
            tabIndex={-1}
            aria-label="Typing arena"
          >
          <div className="game-runtime-bar">
            <Link href="/games" className="game-back-link" aria-label="Back to Games">← <span>Games</span></Link>
            <strong>{MODE_META[mode].label}</strong>
            <span className="adaptive-music-readout" aria-label={`Adaptive music ${adaptiveMusicRef.current.bpm} beats per minute`}>
              <i aria-hidden="true" /> Adaptive music · {adaptiveMusicRef.current.bpm} BPM
            </span>
          </div>
          <div className="mode-brief-panel">
            <div>
              <span>{activeModeMeta.family} · {activeModeMeta.difficulty}</span>
              <strong>{activeModeMeta.objective}</strong>
              <p>{activeModeMeta.rule}</p>
            </div>
            <button className="ghost-btn" onClick={() => applyRecommendedModeSetup(mode)}>
              Use recommended setup
            </button>
          </div>
          <div className="play-tuning-panel" aria-label="Run tuning">
            <label>
              Time
              <select value={durationSec} onChange={(event) => setDurationSec(Number(event.target.value))}>
                <option value={30}>30s</option>
                <option value={60}>60s</option>
                <option value={90}>90s</option>
                <option value={120}>120s</option>
              </select>
            </label>
            <label>
              Pack
              <select value={dictionaryPack} onChange={(event) => setDictionaryPack(event.target.value as DictionaryPack)}>
                <option value="core">Core</option>
                <option value="tech">Tech</option>
                <option value="top1k">Top 1K</option>
                <option value="top5k">Top 5K</option>
                <option value="top10k">Top 10K</option>
                <option value="verbs">Verbs</option>
                <option value="nouns">Nouns</option>
                <option value="code">Code</option>
              </select>
            </label>
            <button
              type="button"
              className={`toggle-pill ${settings.punctuation ? "active" : ""}`}
              aria-pressed={settings.punctuation}
              onClick={() => setSettings((prev) => ({ ...prev, punctuation: !prev.punctuation }))}
            >
              Punctuation
            </button>
            <button
              type="button"
              className={`toggle-pill ${settings.numbers ? "active" : ""}`}
              aria-pressed={settings.numbers}
              onClick={() => setSettings((prev) => ({ ...prev, numbers: !prev.numbers }))}
            >
              Numbers
            </button>
            <button
              type="button"
              className={`toggle-pill ${settings.lowercase ? "active" : ""}`}
              aria-pressed={settings.lowercase}
              onClick={() => setSettings((prev) => ({ ...prev, lowercase: !prev.lowercase }))}
            >
              Lowercase
            </button>
            <button
              type="button"
              className={`toggle-pill ${settings.customOnly ? "active" : ""}`}
              aria-pressed={settings.customOnly}
              onClick={() => setSettings((prev) => ({ ...prev, customOnly: !prev.customOnly }))}
            >
              Custom only
            </button>
            <label>
              Word shape
              <select
                value={activeModeTuning.wordShape}
                onChange={(event) => updateActiveModeTuning({ wordShape: event.target.value as WordShape })}
              >
                <option value="compact">Compact</option>
                <option value="balanced">Balanced</option>
                <option value="wide">Wide</option>
                <option value="wild">Wild</option>
              </select>
            </label>
            <label>
              Intensity
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={activeModeTuning.intensity}
                onChange={(event) => updateActiveModeTuning({ intensity: Number(event.target.value) })}
              />
            </label>
            {(mode === "pulse" || mode === "duel" || mode === "chart") && (
              <>
                <label>
                  BPM
                  <input
                    type="range"
                    min={70}
                    max={180}
                    step={1}
                    value={pulseBpm}
                    onChange={(event) => setPulseBpm(clamp(Number(event.target.value), 70, 180))}
                  />
                </label>
                <label>
                  Beat window
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    value={activeModeTuning.strictness}
                    onChange={(event) => updateActiveModeTuning({ strictness: Number(event.target.value) })}
                  />
                </label>
              </>
            )}
            {mode === "duel" && (
              <label>
                Rival pace
                <input
                  type="range"
                  min={70}
                  max={125}
                  step={1}
                  value={activeModeTuning.rivalPace}
                  onChange={(event) => updateActiveModeTuning({ rivalPace: Number(event.target.value) })}
                />
              </label>
            )}
            {mode === "meteor" && (
              <label>
                Herd density
                <input
                  type="range"
                  min={3}
                  max={7}
                  step={1}
                  value={activeModeTuning.density}
                  onChange={(event) => updateActiveModeTuning({ density: Number(event.target.value) })}
                />
              </label>
            )}
            {mode === "gravity" && (
              <label>
                Flip interval
                <input
                  type="range"
                  min={2}
                  max={12}
                  step={1}
                  value={activeModeTuning.intervalSec}
                  onChange={(event) => updateActiveModeTuning({ intervalSec: Number(event.target.value) })}
                />
              </label>
            )}
            {(mode === "blackout" || mode === "stealth") && (
              <label>
                Reveal edge
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={1}
                  value={activeModeTuning.reveal}
                  onChange={(event) => updateActiveModeTuning({ reveal: Number(event.target.value) })}
                />
              </label>
            )}
            {(mode === "infection" || mode === "relay") && (
              <label>
                {mode === "infection" ? "Spread" : "Rollback"}
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={1}
                  value={activeModeTuning.spread}
                  onChange={(event) => updateActiveModeTuning({ spread: Number(event.target.value) })}
                />
              </label>
            )}
            {mode === "rogue" && (
              <label>
                Perk cadence
                <input
                  type="range"
                  min={8}
                  max={30}
                  step={1}
                  value={activeModeTuning.perkEvery}
                  onChange={(event) => updateActiveModeTuning({ perkEvery: Number(event.target.value) })}
                />
              </label>
            )}
            {mode === "coop" && (
              <label>
                Pilots
                <input
                  type="range"
                  min={2}
                  max={4}
                  step={1}
                  value={activeModeTuning.teamSize}
                  onChange={(event) => updateActiveModeTuning({ teamSize: Number(event.target.value) })}
                />
              </label>
            )}
            {mode === "code" && (
              <>
                <label>
                  Language
                  <select
                    value={codeLanguage}
                    onChange={(event) => {
                      setCodeLanguage(event.target.value as CodeLanguage);
                    }}
                  >
                    <option value="typescript">TypeScript</option>
                    <option value="python">Python</option>
                    <option value="rust">Rust</option>
                    <option value="sql">SQL</option>
                  </select>
                </label>
                <label>
                  Layout
                  <select
                    value={codeIndentMode}
                    onChange={(event) => {
                      setCodeIndentMode(event.target.value as CodeIndentMode);
                    }}
                  >
                    <option value="preserve">Preserve indentation</option>
                    <option value="flat">Flat tokens</option>
                  </select>
                </label>
              </>
            )}
          </div>
          <div className="arena-glow" />
          <div className="arena-headline">
            <div>
              <p>Run state</p>
              <h2 aria-live="polite">{phase}</h2>
              {challengeActive && dailyChallenge && (
                <p className="dictionary-note">Daily challenge active: {dailyChallenge.date}</p>
              )}
            </div>
            <div className="timer-chip">{timerText}</div>
          </div>
          <div className="run-indicator-strip" aria-label="Run indicators">
            {runIndicatorCards.map((card) => (
              <article key={`indicator-${card.key}`} className="run-indicator-card">
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </article>
            ))}
          </div>
          {(mode === "pulse" || mode === "duel" || mode === "chart") && (
            <section className={`rhythm-stage ${pulseJudge ? `judge-${pulseJudge.tone}` : ""}`}>
              <div className={`pulse-banner ${pulseState.quality !== "miss" ? "active" : ""}`}>
                {mode === "duel"
                  ? `Rhythm duel live: keep beat and outrun rival pace (${pulseBpm} BPM).`
                  : mode === "chart"
                    ? `Rhythm chart live: strict beatmap windows (${pulseBpm} BPM).`
                    : `Rhythm mode: submit each word on beat for extra score (${pulseBpm} BPM).`}
              </div>
              <div className="pulse-lane" aria-hidden="true">
                <div className="pulse-grid-ticks">
                  {Array.from({ length: 9 }).map((_, index) => (
                    <span key={`pulse-tick-${index}`} />
                  ))}
                </div>
                <div className="pulse-target" />
                <div className="pulse-sweep" style={{ left: `${pulseState.phase * 100}%` }} />
              </div>
              {pulseJudge && (
                <div className={`pulse-judge ${pulseJudge.tone}`}>
                  <span>{pulseJudge.label}</span>
                </div>
              )}
            </section>
          )}
          {mode === "duel" && (
            <div className="duel-bars">
              <div>
                <span>You</span>
                <strong>{Math.round(clamp((stats.correctChars / Math.max(1, stats.correctChars + 120)) * 100, 0, 100))}%</strong>
              </div>
              <div>
                <span>Rival</span>
                <strong>{Math.round(duelRivalProgress)}%</strong>
              </div>
            </div>
          )}

          {mode !== "meteor" ? (
            <div
              className={`prompt-shell ${
                mode === "reverse" || gravityFlip ? "reverse-flow" : ""
              } ${mode === "pulse" || mode === "duel" || mode === "chart" ? "rhythm-prompt" : ""} prompt-shell--${mode}`}
            >
              {visibleWords.map(({ word, index }) => {
                const codeIndent = mode === "code" ? codeLineStarts[index] : undefined;
                const displayWord = index === currentIndex && mode === "echo" && echoPending ? echoPending : word;
                const encodedWord =
                  mode === "cipher" ? encodeCipherWord(displayWord, cipherSignedShift) : displayWord;
                const shownWord =
                  mode === "stealth" && index >= currentIndex
                    ? maskInnerLetters(encodedWord)
                    : encodedWord;
                const driftX =
                  mode === "drift"
                    ? Math.sin(stats.elapsedSec * (1.6 + activeModeTuning.intensity * 0.32) + index * 0.62) *
                      (5 + activeModeTuning.intensity * 3.5)
                    : 0;
                const infected = mode === "infection" && infectedIndices.includes(index);
                if (index < currentIndex) {
                  return (
                    <Fragment key={`${index}-${word}`}>
                      {codeIndent != null && (
                        <span className="code-line-break" style={{ "--indent": codeIndent } as CSSProperties} />
                      )}
                    <span
                      className={`prompt-word ${wordResults[index] === "good" ? "good" : "bad"} ${
                        infected ? "infected" : ""
                      }`}
                      style={mode === "drift" ? { transform: `translateX(${driftX}px)` } : undefined}
                    >
                      {shownWord}
                    </span>
                    </Fragment>
                  );
                }
                if (index === currentIndex) {
                  return (
                    <Fragment key={`${index}-${word}`}>
                      {codeIndent != null && (
                        <span className="code-line-break" style={{ "--indent": codeIndent } as CSSProperties} />
                      )}
                    <span
                      className={`prompt-word current ${infected ? "infected" : ""}`}
                      style={mode === "drift" ? { transform: `translateX(${driftX}px)` } : undefined}
                    >
                      {mode === "coop" && <span className="word-badge">P{coopTurn}</span>}
                      {infected && <span className="word-badge word-badge--danger">infected</span>}
                      {displayWord.split("").map((char, charIndex) => {
                        const typedChar = typedPreview[charIndex];
                        const encodedChar = mode === "cipher" ? encodeCipherWord(char, cipherSignedShift) : char;
                        const revealCount = Math.round(clamp(activeModeTuning.reveal, 0, 3));
                        const shownChar =
                          mode === "blackout" && typedChar !== undefined && charIndex >= revealCount
                            ? "•"
                            : mode === "stealth" &&
                                charIndex >= revealCount &&
                                charIndex < displayWord.length - revealCount
                              ? "•"
                              : encodedChar;
                        if (typedChar === undefined) {
                          return (
                            <span key={charIndex} className="pending">
                              {shownChar}
                            </span>
                          );
                        }
                        if (typedChar === char) {
                          return (
                            <span key={charIndex} className="correct">
                              {shownChar}
                            </span>
                          );
                        }
                        return (
                          <span key={charIndex} className="wrong">
                            {shownChar}
                          </span>
                        );
                      })}
                      {typedPreview.length > displayWord.length && (
                        <span className="extra">{typedPreview.slice(displayWord.length)}</span>
                      )}
                    </span>
                    </Fragment>
                  );
                }
                return (
                  <Fragment key={`${index}-${word}`}>
                    {codeIndent != null && (
                      <span className="code-line-break" style={{ "--indent": codeIndent } as CSSProperties} />
                    )}
                  <span
                    className={`prompt-word future ${infected ? "infected" : ""}`}
                    style={mode === "drift" ? { transform: `translateX(${driftX}px)` } : undefined}
                  >
                    {infected && <span className="word-badge word-badge--danger">infected</span>}
                    {shownWord}
                  </span>
                  </Fragment>
                );
              })}
            </div>
          ) : (
            <div className="meteor-shell" aria-label="Meteor lane">
              <div className="meteor-skyfield" aria-hidden="true" />
              <div
                className="ship-cockpit elephant-cockpit"
                aria-hidden="true"
                style={{ transform: `translateX(-50%) rotate(${shipAimDeg}deg)` }}
              >
                <img src="/logo.png" alt="" width={94} height={94} />
              </div>
              {lockedMeteorWord && (
                <div
                  className="tracking-laser"
                  aria-hidden="true"
                  style={{
                    left: "50%",
                    top: "92%",
                    width: `${Math.hypot(lockedMeteorWord.xPercent - 50, lockedMeteorWord.yPercent - 92)}%`,
                    transform: `rotate(${(Math.atan2(lockedMeteorWord.yPercent - 92, lockedMeteorWord.xPercent - 50) * 180) / Math.PI}deg)`,
                  }}
                />
              )}
              {laserFx.map((fx) => {
                const shipX = 50;
                const shipY = 92;
                const trackedTarget =
                  fx.lockId != null ? meteorWordsView.find((word) => word.id === fx.lockId) : undefined;
                const targetX = trackedTarget?.xPercent ?? fx.xPercent;
                const targetY = trackedTarget?.yPercent ?? fx.yPercent;
                const dx = targetX - shipX;
                const dy = targetY - shipY;
                const length = Math.hypot(dx, dy);
                const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
                return (
                  <div
                    key={fx.id}
                    className="laser-shot"
                    aria-hidden="true"
                    style={{
                      left: `${shipX}%`,
                      top: `${shipY}%`,
                      width: `${length}%`,
                      transform: `rotate(${angleDeg}deg)`,
                    }}
                  >
                    <span className="laser-shot-core" />
                    <span className="laser-shot-tip" />
                  </div>
                );
              })}
              {explosionFx.map((fx) => (
                <div
                  key={fx.id}
                  className="meteor-explosion"
                  aria-hidden="true"
                  style={{
                    left: `${fx.xPercent}%`,
                    top: `${fx.yPercent}%`,
                  }}
                >
                  <span className="meteor-explosion-core" />
                  <span className="meteor-explosion-ring" />
                  <span className="meteor-explosion-sparks" />
                </div>
              ))}
              {meteorWordsView.map((word) => {
                const isLocked = word.id === meteorSelection.id;
                const typed = meteorSelection.typed;
                const progress = isLocked && word.text.length > 0 ? typed.length / word.text.length : 0;
                return (
                  <div
                    key={word.id}
                    className={`meteor-word ${isLocked ? "locked" : ""}`}
                    style={{
                      left: `${word.xPercent}%`,
                      top: `${word.yPercent}%`,
                      transform: "translate(-50%, 0)",
                    }}
                  >
                    <span className="meteor-word-text">{isLocked ? word.text.slice(typed.length) || "..." : word.text}</span>
                    {isLocked && (
                      <>
                        <span className="meteor-word-progress" style={{ transform: `scaleX(${progress})` }} />
                        <span className="meteor-word-tail">{typed.length}/{word.text.length}</span>
                      </>
                    )}
                  </div>
                );
              })}
              <div className="meteor-floor">savanna line</div>
            </div>
          )}

          {mode !== "meteor" ? (
            <div className="control-row">
              <p className="control-hint">
                {typedPreview
                  ? `Current input: ${typedPreview}`
                  : "Type anywhere to start. Space submits the word."}
              </p>
              <button className="launch-btn" onClick={toggleSession}>
                {isRunning ? "Stop" : "Start"}
              </button>
              <button className="ghost-btn" onClick={() => resetSession(false)} aria-keyshortcuts="Escape">
                Reset
              </button>
              <button className="ghost-btn" onClick={() => resetSession(true)}>
                Shuffle words
              </button>
            </div>
          ) : (
            <div className="meteor-controls">
              <div className="meteor-chip">
                <span>Target</span>
                <strong>{lockedMeteorWord?.text ?? "none"}</strong>
              </div>
              <div className="meteor-chip">
                <span>Typed</span>
                <strong>{meteorSelection.typed || "..."}</strong>
              </div>
              <button className="launch-btn" onClick={toggleSession}>
                {isRunning ? "Stop" : "Start"}
              </button>
              <button className="ghost-btn" onClick={() => resetSession(false)} aria-keyshortcuts="Escape">
                Reset
              </button>
              <button className="ghost-btn" onClick={() => resetSession(true)}>
                Shuffle words
              </button>
            </div>
          )}
          {mode === "meteor" && (
            <p className="meteor-tip">
              Type a first letter to lock the nearest word. Press space to bank current progress and release target.
              Meteors spawn high and speed up over time.
            </p>
          )}
          {mode === "meteor" && (
            <p className="sr-only">
              Current meteor target: {lockedMeteorWord?.text ?? "none"}. Typed progress:{" "}
              {meteorSelection.typed || "none"}.
            </p>
          )}

          <div className="legend-line">
            <span className="dot good" />
            match
            <span className="dot bad" />
            miss
            {mode === "meteor" ? (
              <>
                <span className="dot now" />
                locked target
              </>
            ) : (
              <>
                <span className="dot now" />
                current word
              </>
            )}
          </div>
          <div className="mode-rule-grid">
            <p>
              <span>Input</span>
              {mode === "meteor"
                ? "Type matching letters to lock targets. Space banks progress."
                : "Type anywhere. Space submits a word. Backspace edits or undoes the last submit."}
            </p>
            <p>
              <span>Rule</span>
              {activeModeMeta.rule}
            </p>
            <p>
              <span>Scoring</span>
              {activeModeMeta.scoring}
              {mode === "chain" ? ` Current combo x${chainCombo}.` : ""}
              {mode === "coop" ? ` Active pilot ${coopTurn}.` : ""}
            </p>
            <p>
              <span>Ghost</span>
              {ghostStatus}
            </p>
          </div>
          {mode === "rogue" && rogueOffer && (
            <div className="rogue-offers">
              {rogueOffer.map((offer, offerIndex) => (
                <button key={offer.id} className="ghost-btn" onClick={() => applyRogueOffer(offerIndex)}>
                  {offerIndex + 1}. {offer.name}
                  <span>{offer.description}</span>
                </button>
              ))}
            </div>
          )}
          {focusModeActive && focusPrefs.showStats && focusStatCards.length > 0 && (
            <aside className="focus-hud">
              {focusStatCards.map((card) => (
                <article key={`focus-value-${card.key}`}>
                  <p>{card.label}</p>
                  <h4>{card.value}</h4>
                </article>
              ))}
            </aside>
          )}
          </section>
        )}

        {appRoute !== "play" && <aside className={`intel-stack ${showArena ? "" : "intel-stack-wide"}`}>
          <section className="route-intro">
            <div className="route-intro-head">
              <div>
                <h3>{ROUTE_COPY[appRoute].title}</h3>
                <p>{ROUTE_COPY[appRoute].subtitle}</p>
              </div>
              {appRoute !== "home" && (
                <button className="ghost-btn back-btn" onClick={() => goBack()}>
                  Back
                </button>
              )}
            </div>
          </section>

          {appRoute === "home" && (
            <section className="home-hero">
              <div className="home-hero-grid">
                <div>
                  <p className="home-eyebrow">Typing platform</p>
                  <h2>Typing practice with fast drills and creative game modes.</h2>
              <p>
                Build speed and accuracy with timed runs, explore the game library, and track your progress on the boards and in the training lab.
              </p>
                  <div className="hero-pill-row">
                    <span className="hero-pill">{GAME_MODES.length} modes</span>
                    <span className="hero-pill">{dictionaryPack.toUpperCase()} active pack</span>
                    <span className="hero-pill">{(bestByMode[mode] ?? 0).toFixed(1)} best WPM</span>
                    <span className="hero-pill">{dailyChallenge ? dailyChallenge.date : "Daily ready"}</span>
                  </div>
                  <div className="hero-actions">
                    <button className="launch-btn" onClick={() => navigateToRoute("play")}>
                      Open games
                    </button>
                    <button className="ghost-btn" onClick={() => navigateToRoute("play")}>
                      Browse games
                    </button>
                    <button className="ghost-btn" onClick={() => navigateToRoute("boards")}>
                      Open boards
                    </button>
                  </div>
                </div>
                <div className="home-hero-art" aria-hidden="true">
                  <div className="hero-orbit hero-orbit-a" />
                  <div className="hero-orbit hero-orbit-b" />
                  <div className="hero-orbit hero-orbit-c" />
                  <div className="hero-preview-card">
                    <span>Current lane</span>
                    <strong>{MODE_META[mode].label}</strong>
                    <p>{MODE_META[mode].flavor}</p>
                  </div>
                  <div className="hero-preview-card secondary">
                    <span>Daily</span>
                    <strong>{dailyChallenge ? MODE_META[dailyChallenge.mode].label : "Ready"}</strong>
                    <p>
                      {dailyChallenge
                        ? `${dailyChallenge.durationSec}s · ${dailyChallenge.dictionaryPack}`
                        : "Fresh run queued."}
                    </p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {appRoute === "home" && (
            <section className="path-grid">
              <article className="path-card">
                <h3>Play Arena</h3>
                <p>Run any mode with instant keyboard capture and low-latency stats.</p>
                <button
                  className="ghost-btn"
                  onClick={() => navigateToRoute("play")}
                >
                  Go to Play
                </button>
              </article>
              <article className="path-card">
                <h3>Game library</h3>
                <p>Compare creative modes, read the rundown, and launch from one control page.</p>
                <button
                  className="ghost-btn"
                  onClick={() => navigateToRoute("play")}
                >
                  Go to Play
                </button>
              </article>
              <article className="path-card">
                <h3>Pilot Profile</h3>
                <p>Manage account sync, duel queue, friends, replay sharing, and webhook endpoints.</p>
                <button
                  className="ghost-btn"
                  onClick={() => navigateToRoute("profile")}
                >
                  Go to Profile
                </button>
              </article>
            </section>
          )}

          {appRoute === "home" && (
            <section className="philosophy-grid">
              <article>
                <h3>Static hubs</h3>
                <p>Each page does one job well: home for overview, play for runs, settings for tuning.</p>
              </article>
              <article>
                <h3>Fast input first</h3>
                <p>Typing stays global. The live HUD is lighter, quicker, and easier to read mid-run.</p>
              </article>
              <article>
                <h3>Modes with character</h3>
                <p>Elephant Run and rhythm modes now look and sound like their own games instead of sharing one shell.</p>
              </article>
            </section>
          )}

          {appRoute === "home" && (
            <section className="leaderboard-block">
              <h3>Quick Launch</h3>
              <div className="custom-actions">
                <button
                  className="launch-btn"
                  onClick={() => navigateToRoute("play")}
                >
                  Start typing
                </button>
                <button
                  className="ghost-btn"
                  onClick={() => navigateToRoute("play")}
                >
                  Browse modes
                </button>
                <button
                  className="ghost-btn"
                  onClick={() => navigateToRoute("profile")}
                >
                  Open profile
                </button>
              </div>
              <div className="quick-launch-meta">
                <p className="dim">
                  Current mode: <strong>{MODE_META[mode].label}</strong> · Best{" "}
                  <strong>{(bestByMode[mode] ?? 0).toFixed(1)} WPM</strong>
                </p>
                {dailyChallenge && (
                  <p className="dim">
                    Daily: {MODE_META[dailyChallenge.mode].label} · {dailyChallenge.durationSec}s ·{" "}
                    {dailyChallenge.dictionaryPack}
                  </p>
                )}
              </div>
            </section>
          )}

          {appRoute === "home" && (
            <section className="leaderboard-block">
              <h3>Stats</h3>
              <div className="profile-stat-grid">
                <article>
                  <span>Local runs</span>
                  <strong>{localProfileSummary.runs}</strong>
                </article>
                <article>
                  <span>Average WPM</span>
                  <strong>{localProfileSummary.avgWpm.toFixed(1)}</strong>
                </article>
                <article>
                  <span>Best lane</span>
                  <strong>{MODE_META[localProfileSummary.bestMode].label}</strong>
                </article>
                <article>
                  <span>Best WPM</span>
                  <strong>{localProfileSummary.bestWpm.toFixed(1)}</strong>
                </article>
              </div>
            </section>
          )}


          {appRoute === "profile" && (
            <section className="leaderboard-block profile-tabs-panel">
              <div className="profile-tab-row">
                <Link
                  href={pathForProfileSubroute("overview")}
                  className={`profile-tab-link ${profileSubroute === "overview" ? "active" : ""}`}
                >
                  Overview
                </Link>
                <Link
                  href={pathForProfileSubroute("account")}
                  className={`profile-tab-link ${profileSubroute === "account" ? "active" : ""}`}
                >
                  Account
                </Link>
                <Link
                  href={pathForProfileSubroute("security")}
                  className={`profile-tab-link ${profileSubroute === "security" ? "active" : ""}`}
                >
                  Security
                </Link>
                <Link
                  href={pathForProfileSubroute("data")}
                  className={`profile-tab-link ${profileSubroute === "data" ? "active" : ""}`}
                >
                  Data
                </Link>
                <Link
                  href={pathForProfileSubroute("friends")}
                  className={`profile-tab-link ${profileSubroute === "friends" ? "active" : ""}`}
                >
                  Friends
                </Link>
                <Link
                  href={pathForProfileSubroute("duels")}
                  className={`profile-tab-link ${profileSubroute === "duels" ? "active" : ""}`}
                >
                  Duels
                </Link>
                <Link
                  href={pathForProfileSubroute("replays")}
                  className={`profile-tab-link ${profileSubroute === "replays" ? "active" : ""}`}
                >
                  Replays
                </Link>
                <Link
                  href={pathForProfileSubroute("webhooks")}
                  className={`profile-tab-link ${profileSubroute === "webhooks" ? "active" : ""}`}
                >
                  Webhooks
                </Link>
                {isAnalyticsAdmin && (
                  <Link
                    href={pathForProfileSubroute("admin")}
                    className={`profile-tab-link ${profileSubroute === "admin" ? "active" : ""}`}
                  >
                    Admin
                  </Link>
                )}
              </div>
            </section>
          )}

          {appRoute === "profile" && profileSubroute === "overview" && (
            <section className="leaderboard-block profile-overview-grid">
              <article className="profile-overview-card">
                <div className="profile-illustration profile-illustration--shield" aria-hidden="true" />
                <h3>Account</h3>
                <p>Sign in, confirm your current identity, and keep the account basics separate from heavier tools.</p>
                <button className="ghost-btn" onClick={() => router.push(pathForProfileSubroute("account"))}>
                  Open account
                </button>
              </article>
              <article className="profile-overview-card">
                <div className="profile-illustration profile-illustration--signal" aria-hidden="true" />
                <h3>Friends</h3>
                <p>Manage friend requests and sync preferences without ranked queue controls in the way.</p>
                <button className="ghost-btn" onClick={() => router.push(pathForProfileSubroute("friends"))}>
                  Open friends
                </button>
              </article>
              <article className="profile-overview-card">
                <div className="profile-illustration profile-illustration--relay" aria-hidden="true" />
                <h3>Security</h3>
                <p>Password changes, session review, exports, and deletion are split into focused account pages.</p>
                <button className="ghost-btn" onClick={() => router.push(pathForProfileSubroute("security"))}>
                  Open security
                </button>
              </article>
              {isAnalyticsAdmin && (
                <article className="profile-overview-card">
                  <div className="profile-illustration profile-illustration--signal" aria-hidden="true" />
                  <h3>Admin</h3>
                  <p>Review accounts, remove abusive users, and moderate leaderboard rows from one focused page.</p>
                  <button className="ghost-btn" onClick={() => router.push(pathForProfileSubroute("admin"))}>
                    Open admin
                  </button>
                </article>
              )}
            </section>
          )}

          {appRoute === "profile" && profileSubroute === "overview" && (
            <section className="leaderboard-block">
              <h3>Pilot Record</h3>
              <div className="profile-stat-grid">
                <article>
                  <span>Local runs</span>
                  <strong>{localProfileSummary.runs}</strong>
                </article>
                <article>
                  <span>Average WPM</span>
                  <strong>{localProfileSummary.avgWpm.toFixed(1)}</strong>
                </article>
                <article>
                  <span>Best lane</span>
                  <strong>{MODE_META[localProfileSummary.bestMode].label}</strong>
                </article>
                <article>
                  <span>Best WPM</span>
                  <strong>{localProfileSummary.bestWpm.toFixed(1)}</strong>
                </article>
                <article>
                  <span>Ghost saves</span>
                  <strong>{localProfileSummary.ghosts}</strong>
                </article>
                <article>
                  <span>Replay events</span>
                  <strong>{localProfileSummary.replayEvents}</strong>
                </article>
              </div>
              {accountProfile && (
                <p className="dim">
                  Account rating {accountProfile.rating} · Verified runs {accountProfile.verifiedRuns} · Locale{" "}
                  {accountProfile.locale}
                </p>
              )}
            </section>
          )}

          {appRoute === "profile" && profileSubroute === "account" && (
            <section className="leaderboard-block profile-section">
              <h3>Account</h3>
              {accountProfile ? (
                <div className="account-state-card">
                  <div>
                    <p className="home-eyebrow">Signed in</p>
                    <h4>{accountProfile.handle}</h4>
                    <p className="dim">
                      Rating {accountProfile.rating} · Verified runs {accountProfile.verifiedRuns} · Locale{" "}
                      {accountProfile.locale}
                    </p>
                  </div>
                  <div className="account-state-actions">
                    <button className="ghost-btn" onClick={() => void refreshAccountProfile()}>
                      Refresh profile
                    </button>
                    <button className="ghost-btn" onClick={() => void logoutCurrentAccountFlow()}>
                      Sign out
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="dim profile-note">
                    Guests can play locally. Sign in to sync profile data, manage friends, publish replays, and keep
                    account-owned records.
                  </p>
                  <label>
                    Handle
                    <input value={authHandle} onChange={(event) => setAuthHandle(event.target.value)} maxLength={24} />
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                      maxLength={128}
                    />
                  </label>
                  <label>
                    Locale
                    <input value={authLocale} onChange={(event) => setAuthLocale(event.target.value)} maxLength={12} />
                  </label>
                  <TurnstileWidget
                    siteKey={turnstileSiteKey}
                    resetKey={authTurnstileResetKey}
                    onTokenChange={setAuthTurnstileToken}
                  />
                  <div className="custom-actions profile-actions">
                    <button className="launch-btn" onClick={() => void registerAccountFlow()}>
                      Register
                    </button>
                    <button className="ghost-btn" onClick={() => void loginAccountFlow()}>
                      Login
                    </button>
                  </div>
                </>
              )}
              {authNote && <p className="dim">{authNote}</p>}
            </section>
          )}

          {appRoute === "profile" && profileSubroute === "security" && (
            <section className="leaderboard-block profile-section">
              <h3>Security + Sessions</h3>
              <div className="profile-lifecycle-grid">
                <article className="profile-subcard">
                  <div className="profile-illustration profile-illustration--shield" aria-hidden="true" />
                  <p className="home-eyebrow">Password</p>
                  <label>
                    Current password
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                      maxLength={128}
                    />
                  </label>
                  <label>
                    New password
                    <input
                      type="password"
                      value={authNewPassword}
                      onChange={(event) => setAuthNewPassword(event.target.value)}
                      maxLength={128}
                    />
                  </label>
                  <div className="custom-actions profile-actions">
                    <button className="launch-btn" disabled={!accountToken} onClick={() => void changePasswordFlow()}>
                      Change password
                    </button>
                    <button className="ghost-btn" disabled={!accountToken} onClick={() => void logoutCurrentAccountFlow()}>
                      Sign out this session
                    </button>
                  </div>
                  <p className="dim profile-note">
                    No email recovery is available in this release. Keep your password in a password manager.
                  </p>
                </article>
                <article className="profile-subcard">
                  <div className="profile-illustration profile-illustration--orbit" aria-hidden="true" />
                  <div className="profile-subcard-head">
                    <div>
                      <p className="home-eyebrow">Sessions</p>
                      <h4>Active devices</h4>
                    </div>
                    <div className="custom-actions profile-actions compact">
                      <button className="ghost-btn" disabled={!accountToken} onClick={() => void refreshAccountSessions()}>
                        Refresh
                      </button>
                      <button className="ghost-btn" disabled={!accountToken} onClick={() => void logoutOtherSessionsFlow()}>
                        Sign out others
                      </button>
                    </div>
                  </div>
                  {accountSessions.length > 0 ? (
                    <ol className="session-list">
                      {accountSessions.map((session) => (
                        <li key={session.id} className="session-row">
                          <div className="session-copy">
                            <span className="session-title">
                              {session.label}
                              {session.isCurrent && <i className="session-tag">Current</i>}
                            </span>
                            <span className="session-meta">
                              Last seen {new Date(session.lastSeenAt).toLocaleString()}
                            </span>
                          </div>
                          {!session.isCurrent && (
                            <button className="ghost-btn" onClick={() => void revokeSessionFlow(session.id)}>
                              Revoke
                            </button>
                          )}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="dim profile-note">No active sessions loaded yet.</p>
                  )}
                </article>
              </div>
              {accountLifecycleNote && <p className="dim profile-note">{accountLifecycleNote}</p>}
            </section>
          )}

          {appRoute === "profile" && profileSubroute === "data" && (
            <section className="leaderboard-block profile-section">
              <h3>Data Rights</h3>
              <div className="profile-lifecycle-grid">
                <article className="profile-subcard">
                  <div className="profile-illustration profile-illustration--export" aria-hidden="true" />
                  <p className="home-eyebrow">Export</p>
                  <h4>Download your data</h4>
                  <p className="dim profile-note">
                    Export account data, preferences, sessions, replay shares, webhooks, and leaderboard-related rows.
                  </p>
                  <div className="custom-actions profile-actions">
                    <button className="launch-btn" disabled={!accountToken} onClick={() => void exportAccountDataFlow()}>
                      Export account data
                    </button>
                  </div>
                </article>
                <article className="profile-subcard danger-card">
                  <div className="profile-illustration profile-illustration--danger" aria-hidden="true" />
                  <p className="home-eyebrow">Deletion</p>
                  <h4>Delete account</h4>
                  <p className="dim profile-note">
                    This removes account sessions, preferences, replay shares, webhooks, and score rows matching your handle.
                  </p>
                  <div className="custom-actions profile-actions">
                    <button className="ghost-btn danger-btn" disabled={!accountToken} onClick={openDeleteModal}>
                      Delete account
                    </button>
                  </div>
                </article>
              </div>
              {accountLifecycleNote && <p className="dim profile-note">{accountLifecycleNote}</p>}
            </section>
          )}

          {appRoute === "profile" && profileSubroute === "friends" && (
            <section className="leaderboard-block">
              <h3>Cloud Sync + Friends</h3>
              {!liveSocialEnabled && <p className="dim">{socialLaunchNote}</p>}
              <div className="custom-actions">
                <button
                  className="launch-btn"
                  disabled={!accountToken}
                  onClick={() => void updateAccountPreferences(accountToken, accountPrefs)}
                >
                  Save prefs
                </button>
                <button className="ghost-btn" disabled={!accountToken} onClick={() => void refreshFriends()}>
                  Refresh
                </button>
              </div>
              <label>
                Add friend
                <input value={friendHandle} onChange={(event) => setFriendHandle(event.target.value)} maxLength={24} />
              </label>
              <div className="custom-actions">
                <button className="ghost-btn" disabled={!accountToken} onClick={() => void sendFriendRequest()}>
                  Send request
                </button>
              </div>
              <p className="dim">Friends: {friends.friends.length}</p>
              <ol>
                {friends.friends.slice(0, 8).map((friend) => (
                  <li key={friend.id}>
                    <span>{friend.handle}</span>
                    <strong>{friend.rating}</strong>
                  </li>
                ))}
              </ol>
              {friends.incoming.length > 0 && (
                <div className="custom-actions">
                  {friends.incoming.slice(0, 4).map((request) => (
                    <button
                      key={request.requestId}
                      className="ghost-btn"
                      onClick={() => void respondFriendRequest(request.requestId, true)}
                    >
                      Accept {request.fromHandle}
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {appRoute === "profile" && profileSubroute === "duels" && (
            <section className="leaderboard-block">
              <h3>Ranked + Duel</h3>
              {!liveSocialEnabled && <p className="dim">{socialLaunchNote}</p>}
              <div className="custom-actions">
                <button
                  className={duelQueueAction === "ranked" ? "launch-btn" : "ghost-btn"}
                  disabled={!accountToken}
                  onClick={() => void enqueueRankedFlow()}
                >
                  Ranked queue
                </button>
                <button
                  className={duelQueueAction === "casual" ? "launch-btn" : "ghost-btn"}
                  disabled={!accountToken}
                  onClick={() => void enqueueDuelFlow()}
                >
                  Casual duel
                </button>
                <button
                  className={duelQueueAction === "status" ? "launch-btn" : "ghost-btn"}
                  disabled={!accountToken}
                  onClick={() => void refreshRankedStatus()}
                >
                  Status
                </button>
              </div>
              <p className="dim">Queue: {rankedStatus}</p>
              {activeDuel && (
                <>
                  <p className="dim">
                    Duel {activeDuel.kind} · {activeDuel.status}
                  </p>
                  <ol>
                    {activeDuel.players.map((player) => (
                      <li key={player.accountId}>
                        <span>{player.handle}</span>
                        <strong>
                          {player.progress.toFixed(0)}% · {player.wpm.toFixed(1)} WPM
                        </strong>
                      </li>
                    ))}
                  </ol>
                </>
              )}
              {duelNote && <p className="dim">{duelNote}</p>}
            </section>
          )}

          {appRoute === "profile" && profileSubroute === "replays" && (
            <section className="leaderboard-block">
              <h3>Replay Share</h3>
              <p className="dim">
                Replay sharing is account-only so every shared artifact has an owner.
              </p>
              <label>
                Share title
                <input
                  value={replayShareTitle}
                  onChange={(event) => setReplayShareTitle(event.target.value)}
                  maxLength={80}
                />
              </label>
              <div className="custom-actions">
                <button className="launch-btn" disabled={!accountToken} onClick={() => void shareSelectedReplay()}>
                  Share selected replay
                </button>
                <button className="ghost-btn" onClick={() => void refreshReplayShares()}>
                  Refresh shares
                </button>
              </div>
              <label>
                Load shared replay ID
                <input
                  value={sharedReplayIdInput}
                  onChange={(event) => setSharedReplayIdInput(event.target.value)}
                  maxLength={24}
                />
              </label>
              <div className="custom-actions">
                <button className="ghost-btn" onClick={() => void loadSharedReplay()}>
                  Load shared replay
                </button>
              </div>
              {loadedSharedReplay && (
                <p className="dim">
                  Loaded {loadedSharedReplay.id} · {loadedSharedReplay.mode} · {loadedSharedReplay.title}
                </p>
              )}
              <ol>
                {replayShares.slice(0, 6).map((entry) => (
                  <li key={entry.id}>
                    <span>{entry.title}</span>
                    <strong>{entry.id}</strong>
                  </li>
                ))}
              </ol>
              {replayNote && <p className="dim">{replayNote}</p>}
            </section>
          )}

          {appRoute === "profile" && profileSubroute === "webhooks" && (
            <section className="leaderboard-block">
              <h3>Webhooks</h3>
              <p className="dim">
                Send account-owned score, challenge, and test events to your own endpoint.
              </p>
              <label>
                Webhook URL
                <input
                  value={webhookUrl}
                  onChange={(event) => setWebhookUrl(event.target.value)}
                  placeholder="https://example.com/hook"
                />
              </label>
              <label>
                Webhook events
                <input
                  value={webhookEvents}
                  onChange={(event) => setWebhookEvents(event.target.value)}
                  placeholder="score.submitted,webhook.test"
                />
              </label>
              <div className="custom-actions">
                <button
                  className="launch-btn"
                  disabled={!accountToken || !liveSocialEnabled}
                  onClick={() => void createWebhookFlow()}
                >
                  Add webhook
                </button>
                <button
                  className="ghost-btn"
                  disabled={!accountToken || !liveSocialEnabled}
                  onClick={() => void refreshWebhooks()}
                >
                  Refresh hooks
                </button>
              </div>
              {webhooks.length > 0 && (
                <div className="custom-actions">
                  {webhooks.slice(0, 4).map((hook) => (
                    <button
                      key={hook.id}
                      className="ghost-btn"
                      onClick={() => void testWebhookFlow(hook.id)}
                    >
                      Test {hook.id.slice(0, 8)}
                    </button>
                  ))}
                </div>
              )}
              {webhooks.length > 0 && (
                <div className="custom-actions">
                  {webhooks.slice(0, 4).map((hook) => (
                    <button
                      key={`del-${hook.id}`}
                      className="ghost-btn"
                      onClick={() => void deleteWebhookFlow(hook.id)}
                    >
                      Remove {hook.id.slice(0, 8)}
                    </button>
                  ))}
                </div>
              )}
              {webhookNote && <p className="dim">{webhookNote}</p>}
            </section>
          )}

          {appRoute === "profile" && profileSubroute === "admin" && !isAnalyticsAdmin && (
            <section className="leaderboard-block profile-section">
              <h3>Admin</h3>
              <p className="dim">Admin access requires a signed-in allowlisted handle.</p>
            </section>
          )}

          {appRoute === "profile" && profileSubroute === "admin" && isAnalyticsAdmin && (
            <section className="leaderboard-block profile-section">
              <h3>Admin Controls</h3>
              <p className="dim profile-note">
                User deletion removes account-owned sessions, preferences, webhooks, replays, friend requests, and score
                rows. Leaderboard removal deletes only the selected score row.
              </p>
              <div className="admin-seed-strip">
                <div>
                  <strong>Leaderboard bots</strong>
                  <p className="dim profile-note">
                    Adds or updates 12 synthetic, uncertified bot rows across a few modes. Requires the bot seed token.
                  </p>
                </div>
                <label className="compact-field">
                  Seed token
                  <input
                    type="password"
                    value={botSeedToken}
                    onChange={(event) => setBotSeedToken(event.target.value)}
                    placeholder={isDevEnvironment ? "Optional in dev" : "Required"}
                  />
                </label>
                <button className="ghost-btn" disabled={!accountToken} onClick={() => void seedAdminBotRows()}>
                  Seed bots
                </button>
              </div>
              <div className="admin-grid">
                <article className="profile-subcard admin-panel">
                  <div className="profile-subcard-head">
                    <div>
                      <p className="home-eyebrow">Users</p>
                      <h4>Accounts</h4>
                    </div>
                    <button className="ghost-btn" disabled={!accountToken} onClick={() => void refreshAdminUsers()}>
                      Refresh
                    </button>
                  </div>
                  <label>
                    Search handle
                    <input
                      value={adminUserQuery}
                      onChange={(event) => setAdminUserQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void refreshAdminUsers();
                      }}
                      maxLength={24}
                    />
                  </label>
                  <ol className="admin-list">
                    {adminUsers.map((user) => (
                      <li key={user.id} className="admin-row">
                        <div>
                          <span>{user.handle}</span>
                          <small>
                            Rating {user.rating} · {user.scoreCount} scores · {user.sessionCount} sessions
                          </small>
                        </div>
                        <button className="ghost-btn danger-btn" onClick={() => void removeAdminUser(user)}>
                          Delete
                        </button>
                      </li>
                    ))}
                  </ol>
                  {adminUsers.length === 0 && <p className="dim profile-note">No users loaded.</p>}
                </article>

                <article className="profile-subcard admin-panel">
                  <div className="profile-subcard-head">
                    <div>
                      <p className="home-eyebrow">Leaderboard</p>
                      <h4>Score rows</h4>
                    </div>
                    <button
                      className="ghost-btn"
                      disabled={!accountToken}
                      onClick={() => void refreshAdminLeaderboardRows()}
                    >
                      Refresh
                    </button>
                  </div>
                  <label>
                    Search player
                    <input
                      value={adminLeaderboardQuery}
                      onChange={(event) => setAdminLeaderboardQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void refreshAdminLeaderboardRows();
                      }}
                      maxLength={24}
                    />
                  </label>
                  <ol className="admin-list">
                    {adminLeaderboardRows.map((row) => (
                      <li key={row.id} className="admin-row">
                        <div>
                          <span>
                            {row.username} · {row.mode}
                          </span>
                          <small>
                            {row.wpm.toFixed(1)} WPM · {row.accuracy.toFixed(1)}% ·{" "}
                            {new Date(row.createdAt).toLocaleDateString()}
                          </small>
                        </div>
                        <button className="ghost-btn danger-btn" onClick={() => void removeAdminLeaderboardRow(row)}>
                          Remove
                        </button>
                      </li>
                    ))}
                  </ol>
                  {adminLeaderboardRows.length === 0 && <p className="dim profile-note">No scores loaded.</p>}
                </article>
              </div>
              {adminNote && <p className="dim profile-note">{adminNote}</p>}
              <article className="profile-subcard admin-panel pack-qa-panel">
                <h4>Pack QA</h4>
                <p className="dim profile-note">
                  Counts and samples come from the same dictionary builder used by live runs.
                </p>
                <div className="pack-qa-grid">
                  {dictionaryQaRows.map((row) => (
                    <div key={`pack-qa-${row.pack}`} className="pack-qa-card">
                      <div>
                        <strong>{row.pack}</strong>
                        <span>{row.count.toLocaleString()} words</span>
                      </div>
                      <p>{row.sample.join(" ")}</p>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          )}

          {appRoute === "settings" && (
            <section className="stats-block">
              <h3>Run Stats</h3>
              <div className="stat-grid">
                {statCards.map((card) => (
                  <article key={card.key}>
                    <p className="stat-title">
                      {card.label}
                      <button
                        type="button"
                        className="stat-help"
                        aria-label={`${card.label} help`}
                        data-help={card.help}
                      >
                        ?
                      </button>
                    </p>
                    <h4>{card.value}</h4>
                  </article>
                ))}
              </div>
            </section>
          )}

          {appRoute === "settings" && (
            <section className="path-grid settings-hub-grid">
              <article className="path-card">
                <h3>Account</h3>
                <p>Sign in, manage sessions, friends, duels, replays, webhooks, and admin tools.</p>
                <button className="ghost-btn" onClick={() => navigateToRoute("profile")}>
                  Open account settings
                </button>
              </article>
              <article className="path-card">
                <h3>Privacy</h3>
                <p>Choose local storage, anonymous usage stats, cookies, and analytics review.</p>
                <button className="ghost-btn" onClick={() => navigateToRoute("privacy")}>
                  Open privacy settings
                </button>
              </article>
            </section>
          )}

          {appRoute === "settings" && (
            <section className="leaderboard-block">
              <h3>Privacy Controls</h3>
              <p className="dim">
                Consent, storage controls, cookie policy, and analytics review now live in the dedicated Privacy page.
              </p>
              <div className="custom-actions">
                <button
                  className="launch-btn"
                  onClick={() => navigateToRoute("privacy")}
                >
                  Open privacy desk
                </button>
              </div>
            </section>
          )}

          {appRoute === "privacy" && (
            <section className="leaderboard-block privacy-page" id="privacy-controls">
              <h3>Privacy Controls</h3>
              <p className="dim">
                Tracking cookies stay off by default. Anonymous usage stats remain off unless you allow them.
                Functional storage is still used for things you explicitly do, like signed-in sessions, replays,
                dictionaries, and run history.
              </p>
              <div className="privacy-card-grid">
                <article className="privacy-option-card">
                  <div className="privacy-option-head">
                    <div>
                      <strong>Comfort settings on this device</strong>
                      <p>Theme, sound, focus HUD, and input comfort defaults.</p>
                    </div>
                    <label className="privacy-switch">
                      <input
                        type="checkbox"
                        checked={consentDraft.preferences}
                        onChange={(event) =>
                          setConsentDraft((prev) => ({ ...prev, preferences: event.target.checked }))
                        }
                      />
                      <span />
                    </label>
                  </div>
                </article>
                <article className="privacy-option-card">
                  <div className="privacy-option-head">
                    <div>
                      <strong>Anonymous usage stats</strong>
                      <p>Aggregate counts only. No ad IDs, no cross-site tracking, no fingerprinting.</p>
                    </div>
                    <label className="privacy-switch">
                      <input
                        type="checkbox"
                        checked={consentDraft.analytics}
                        onChange={(event) =>
                          setConsentDraft((prev) => ({ ...prev, analytics: event.target.checked }))
                        }
                      />
                      <span />
                    </label>
                  </div>
                </article>
              </div>
              <div className="privacy-meta-grid">
                <article>
                  <span>Cookies</span>
                  <strong>Off by default</strong>
                  <p>No marketing or third-party tracking cookies are shipped.</p>
                </article>
                <article>
                  <span>Browser signal</span>
                  <strong>{doNotTrackEnabled ? "Privacy signal detected" : "No privacy signal"}</strong>
                  <p>{doNotTrackEnabled ? "Your manual choice here still controls TypeShift analytics." : "You can choose aggregate stats manually."}</p>
                </article>
                <article>
                  <span>Storage still used</span>
                  <strong>Functional only</strong>
                  <p>Signed-in session data, custom dictionaries, replays, and active run state.</p>
                </article>
              </div>
              <div className="custom-actions">
                <button className="launch-btn" onClick={() => applyPrivacyConsent(consentDraft)}>
                  Save privacy choices
                </button>
                <button
                  className="ghost-btn"
                  onClick={() => applyPrivacyConsent({ analytics: false, preferences: false })}
                >
                  Essentials only
                </button>
              </div>
              {privacyConsent && (
                <p className="dim">
                  Saved {new Date(privacyConsent.decidedAt).toLocaleString()} · Analytics{" "}
                  {privacyConsent.analytics ? "on" : "off"} · Comfort settings{" "}
                  {privacyConsent.preferences ? "on" : "off"}
                </p>
              )}
              {privacyNote && <p className="dim">{privacyNote}</p>}
            </section>
          )}

          {appRoute === "privacy" && (
            <section className="leaderboard-block privacy-page">
              <h3>Cookie + Storage Policy</h3>
              <div className="privacy-meta-grid">
                <article>
                  <span>Essential app storage</span>
                  <strong>Always available</strong>
                  <p>Needed for login state, replay files, active runs, and custom dictionaries you ask to save.</p>
                </article>
                <article>
                  <span>Comfort storage</span>
                  <strong>Optional</strong>
                  <p>Theme, sound pack, accessibility preset, and HUD layout only save if you allow it.</p>
                </article>
                <article>
                  <span>Audience measurement</span>
                  <strong>Aggregate only</strong>
                  <p>Counts of page views, mode picks, run starts, and run finishes with coarse buckets only.</p>
                </article>
              </div>
            </section>
          )}

          {appRoute === "privacy" && isAnalyticsAdmin && (
            <section className="leaderboard-block privacy-page">
              <h3>Analytics Summary</h3>
              <p className="dim">
                Admin view for aggregate usage counts. In production, this requires your metrics token.
              </p>
              <div className="analytics-toolbar">
                <label>
                  Analytics token
                  <input
                    type="password"
                    value={analyticsAdminToken}
                    onChange={(event) => setAnalyticsAdminToken(event.target.value)}
                    placeholder={isDevEnvironment ? "Optional in dev" : "Required in production"}
                  />
                </label>
                <button className="launch-btn" onClick={() => void refreshAnalyticsSummary()}>
                  Load summary
                </button>
              </div>
              {analyticsSummaryError && <p className="dim">Analytics: {analyticsSummaryError}</p>}
              <div className="analytics-totals-grid">
                {Object.entries(analyticsSummaryTotals).length > 0 ? (
                  Object.entries(analyticsSummaryTotals).map(([eventName, count]) => (
                    <article key={`analytics-total-${eventName}`}>
                      <span>{eventName.replace(/_/g, " ")}</span>
                      <strong>{count}</strong>
                    </article>
                  ))
                ) : (
                  <p className="dim">{analyticsSummaryLoading ? "Loading analytics..." : "No analytics summary loaded yet."}</p>
                )}
              </div>
              {analyticsSummaryRows.length > 0 && (
                <div className="analytics-table-wrap">
                  <table className="analytics-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Event</th>
                        <th>Page</th>
                        <th>Mode</th>
                        <th>Theme</th>
                        <th>Viewport</th>
                        <th>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analyticsSummaryRows.map((row, index) => (
                        <tr key={`analytics-row-${row.dateKey}-${row.eventName}-${index}`}>
                          <td>{row.dateKey}</td>
                          <td>{row.eventName}</td>
                          <td>{row.page ?? "-"}</td>
                          <td>{row.mode ?? "-"}</td>
                          <td>{row.theme ?? "-"}</td>
                          <td>{row.viewportBucket ?? "-"}</td>
                          <td>{row.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {appRoute === "lab" && (
            <section className="custom-block">
              <h3>Custom dictionary</h3>
              <textarea
                value={customInput}
                onChange={(event) => setCustomInput(event.target.value)}
                placeholder="Add your own words here..."
              />
              <div className="custom-actions">
                <button className="launch-btn" onClick={saveCustomDictionary}>
                  Save
                </button>
                <button
                  className="ghost-btn"
                  onClick={() => {
                    setCustomInput("");
                    setCustomWords([]);
                    localStorage.setItem(STORAGE_CUSTOM, JSON.stringify([]));
                    resetSession(true);
                  }}
                >
                  Clear
                </button>
              </div>
            </section>
          )}

          {appRoute === "social" && (
            <section className="leaderboard-block">
              <h3>Multiplayer Race</h3>
              <label>
                Pilot tag
                <input value={raceName} onChange={(event) => setRaceName(event.target.value)} maxLength={24} />
              </label>
              <div className="custom-actions">
                <button className="launch-btn" onClick={() => void createRace()}>
                  Create room
                </button>
                <input
                  value={raceRoomInput}
                  onChange={(event) => setRaceRoomInput(event.target.value.toUpperCase())}
                  placeholder="ROOMID"
                />
                <button className="ghost-btn" onClick={() => void joinRace()}>
                  Join
                </button>
              </div>
              {raceRoomId && (
                <div className="multiplayer-room">
                  <p>
                    Room <strong>{raceRoomId}</strong> {raceState?.status ? `(${raceState.status})` : ""}
                  </p>
                  <button
                    className="launch-btn"
                    onClick={() => void startRace()}
                    disabled={!raceState || raceState.hostPlayerId !== racePlayerId}
                  >
                    Start race
                  </button>
                  <ol>
                    {(raceState?.players ?? []).map((player) => (
                      <li key={player.id}>
                        <span>{player.name}</span>
                        <strong>
                          {player.progress.toFixed(0)}% · {player.wpm.toFixed(1)} WPM
                        </strong>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {raceError && (
                <p className="dim" role="alert">
                  Race: {raceError}
                </p>
              )}
            </section>
          )}

          {appRoute === "social" && (
            <section className="leaderboard-block">
              <h3>Tournament</h3>
              <label>
                Bracket name
                <input
                  value={tournamentName}
                  onChange={(event) => setTournamentName(event.target.value)}
                  maxLength={48}
                />
              </label>
              <label>
                Entrants (one per line)
                <textarea
                  value={tournamentEntrantsInput}
                  onChange={(event) => setTournamentEntrantsInput(event.target.value)}
                  rows={5}
                />
              </label>
              <div className="custom-actions">
                <button className="launch-btn" onClick={() => void createBracket()}>
                  Create bracket
                </button>
                <input
                  value={tournamentLookupId}
                  onChange={(event) => setTournamentLookupId(event.target.value)}
                  placeholder="Tournament ID"
                />
                <button
                  className="ghost-btn"
                  onClick={() => {
                    if (!tournamentLookupId) return;
                    void fetchTournamentState(tournamentLookupId).then(setTournamentState).catch(() => {
                      // no-op
                    });
                  }}
                >
                  Spectate
                </button>
              </div>
              {tournamentState && (
                <div className="tournament-board">
                  <p>
                    {tournamentState.name} · {tournamentState.status}
                  </p>
                  <p className="dim">{tournamentState.id}</p>
                  {tournamentState.matches
                    .slice()
                    .sort((a, b) => a.round - b.round || a.index - b.index)
                    .map((match) => {
                      const aName =
                        tournamentState.players.find((player) => player.id === match.playerAId)?.name ?? "TBD";
                      const bName =
                        tournamentState.players.find((player) => player.id === match.playerBId)?.name ?? "TBD";
                      return (
                        <div key={match.id} className="tournament-match">
                          <p>
                            R{match.round} · Match {match.index + 1}
                          </p>
                          <div className="custom-actions">
                            <button
                              className="ghost-btn"
                              disabled={!match.playerAId}
                              onClick={() => {
                                if (match.playerAId) void markMatchWinner(match.id, match.playerAId);
                              }}
                            >
                              {aName}
                            </button>
                            <button
                              className="ghost-btn"
                              disabled={!match.playerBId}
                              onClick={() => {
                                if (match.playerBId) void markMatchWinner(match.id, match.playerBId);
                              }}
                            >
                              {bName}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
              {tournamentError && (
                <p className="dim" role="alert">
                  Tournament: {tournamentError}
                </p>
              )}
            </section>
          )}

          {appRoute === "lab" && (
            <section className="leaderboard-block">
              <h3>Replay Viewer</h3>
              {replays.length > 0 ? (
                <>
                  <label>
                    Replay run
                    <select
                      value={selectedReplayId || (replays[0]?.id ?? "")}
                      onChange={(event) => setSelectedReplayId(event.target.value)}
                    >
                      {replays.map((run) => (
                        <option key={run.id} value={run.id}>
                          {new Date(run.createdAt).toLocaleString()} · {run.mode} · {run.wpm.toFixed(1)} WPM
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedReplay && (
                    <>
                      <input
                        type="range"
                        min={0}
                        max={selectedReplay.durationMs}
                        value={replayCursorMs}
                        onChange={(event) => setReplayCursorMs(Number(event.target.value))}
                      />
                      <div className="custom-actions">
                        <button className="launch-btn" onClick={() => setReplayPlaying((v) => !v)}>
                          {replayPlaying ? "Pause" : "Play"}
                        </button>
                        <button className="ghost-btn" onClick={() => setReplayCursorMs(0)}>
                          Rewind
                        </button>
                        <button className="ghost-btn" onClick={exportSelectedReplayFile}>
                          Export JSON
                        </button>
                        <button
                          className="ghost-btn"
                          onClick={() => replayImportInputRef.current?.click()}
                        >
                          Import JSON
                        </button>
                        <input
                          ref={replayImportInputRef}
                          type="file"
                          accept="application/json"
                          style={{ display: "none" }}
                          onChange={(event) => {
                            void importReplayFile(event.target.files?.[0]);
                            event.currentTarget.value = "";
                          }}
                        />
                      </div>
                      <p className="dim">
                        {Math.round(replayCursorMs)}ms / {selectedReplay.durationMs}ms
                      </p>
                      <div className="replay-feed">
                        {replayVisibleEvents.map((event, index) => (
                          <span key={`${event.t}-${index}`} className={event.correct ? "good" : "bad"}>
                            {event.kind}:{event.key}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p className="dim">No replays yet.</p>
              )}
              {replayNote && (
                <p className="dim" role="status">
                  {replayNote}
                </p>
              )}
            </section>
          )}

          {appRoute === "lab" && (
            <section className="leaderboard-block">
              <h3>Heatmap + Fingers</h3>
              <div className="heatmap-grid">
                {KEYBOARD_ROWS.map((row) => (
                  <div key={row} className="heatmap-row">
                    {row.split("").map((key) => {
                      const bucket = keyStats[key] ?? { hits: 0, errors: 0 };
                      const errorRate = bucket.hits > 0 ? bucket.errors / bucket.hits : 0;
                      const alpha = Math.min(0.75, errorRate * 1.2 + 0.1);
                      return (
                        <span
                          key={key}
                          className="heatmap-key"
                          style={{ background: `rgba(255, 126, 157, ${alpha})` }}
                          title={`${key.toUpperCase()} · hits ${bucket.hits} · errors ${bucket.errors}`}
                        >
                          {key.toUpperCase()}
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
              <ol>
                {fingerStats.map((finger) => (
                  <li key={finger.finger}>
                    <span>{finger.finger}</span>
                    <strong>
                      {finger.accuracy.toFixed(1)}% · {finger.hits} hits
                    </strong>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {appRoute === "boards" && (
            <section className="leaderboard-block" aria-busy={leaderboardLoading}>
              <h3>Leaderboard</h3>
              {certifiedRun && <p className="dim">Certified-only filter is enabled.</p>}
              {leaderboardLoading && <p className="dim">Loading board...</p>}
              {leaderboardError && <p className="dim">Board offline: {leaderboardError}</p>}
              {!leaderboardLoading && !leaderboardError && leaderboardEntries.length > 0 && (
                <ol>
                  {leaderboardEntries.map((entry) => (
                    <li key={`${entry.rank}-${entry.username}-${entry.createdAt}`}>
                      <span>
                        {entry.rank}. {entry.username}
                        {entry.certified ? " ✓" : ""}
                      </span>
                      <strong>{entry.wpm.toFixed(1)} WPM</strong>
                    </li>
                  ))}
                </ol>
              )}
              {!leaderboardLoading && !leaderboardError && leaderboardEntries.length === 0 && (
                <p className="dim">No scores yet.</p>
              )}
            </section>
          )}

          {appRoute === "boards" && (
            <section className="leaderboard-block" aria-busy={!dailyChallenge}>
              <h3>Daily Challenge</h3>
              {dailyChallenge ? (
                <>
                  <p className="dim">
                    {dailyChallenge.date} · {dailyChallenge.mode} · {dailyChallenge.durationSec}s ·{" "}
                    {dailyChallenge.dictionaryPack}
                  </p>
                  <div className="custom-actions">
                    <button className="launch-btn" onClick={activateDailyChallenge}>
                      Load challenge preset
                    </button>
                    <button
                      className="ghost-btn"
                      onClick={() => {
                        void refreshChallengeAndSeason();
                      }}
                    >
                      Refresh
                    </button>
                  </div>
                </>
              ) : (
                <p className="dim">Loading daily challenge...</p>
              )}
              {challengeNote && (
                <p className="dim" role="status">
                  {challengeNote}
                </p>
              )}
              {challengeError && (
                <p className="dim" role="alert">
                  Challenge: {challengeError}
                </p>
              )}
              {challengeBoard.length > 0 && (
                <ol>
                  {challengeBoard.map((entry) => (
                    <li key={`${entry.rank}-${entry.username}-${entry.createdAt}`}>
                      <span>
                        {entry.rank}. {entry.username}
                      </span>
                      <strong>
                        {entry.points} pts · {entry.wpm.toFixed(1)} WPM
                      </strong>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          {appRoute === "boards" && (
            <section className="leaderboard-block" aria-busy={!seasonWindow && !seasonError}>
              <h3>Season Ladder</h3>
              {seasonWindow && (
                <p className="dim">
                  {seasonWindow.id} · {seasonWindow.startDate} to {seasonWindow.endDate}
                </p>
              )}
              {seasonError && (
                <p className="dim" role="alert">
                  Season: {seasonError}
                </p>
              )}
              {seasonBoard.length > 0 ? (
                <ol>
                  {seasonBoard.map((entry) => (
                    <li key={`${entry.rank}-${entry.username}`}>
                      <span>
                        {entry.rank}. {entry.username}
                      </span>
                      <strong>
                        {entry.points} pts · {entry.bestWpm.toFixed(1)} best
                      </strong>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="dim">No seasonal entries yet.</p>
              )}
            </section>
          )}

        </aside>}
      </main>

      {!privacyConsent && (
        <section className="consent-banner" aria-label="Privacy choices">
          <div>
            <strong>No tracking cookies by default.</strong>
            <p>
              Anonymous usage stats stay off unless you allow them. You can also leave comfort-setting storage off and
              still use the site.
            </p>
          </div>
          <div className="consent-actions">
            <button
              className="launch-btn"
              onClick={() => applyPrivacyConsent({ analytics: true, preferences: true })}
            >
              Allow anonymous stats
            </button>
            <button
              className="ghost-btn"
              onClick={() => applyPrivacyConsent({ analytics: false, preferences: false })}
            >
              Essentials only
            </button>
            <button
              className="ghost-btn"
              onClick={() => {
                navigateToRoute("privacy");
              }}
            >
              Choose manually
            </button>
          </div>
        </section>
      )}

      {deleteModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-account-title">
          <section className="modal-card danger-card">
            <p className="home-eyebrow">Permanent action</p>
            <h3 id="delete-account-title">Delete account</h3>
            <p className="dim profile-note">
              This removes your profile, sessions, replay shares, webhooks, synced preferences, and score rows linked
              to your handle. This cannot be undone.
            </p>
            <ul className="legal-list profile-note">
              <li>You will be signed out on this device.</li>
              <li>Other active sessions will stop working.</li>
              <li>Replay share links owned by this account will be removed.</li>
            </ul>
            <label>
              Type your handle to confirm deletion
              <input
                value={deleteHandleConfirm}
                onChange={(event) => setDeleteHandleConfirm(event.target.value)}
                maxLength={24}
              />
            </label>
            <div className="modal-actions">
              <button className="ghost-btn" onClick={closeDeleteModal}>
                Cancel
              </button>
              <button className="ghost-btn danger-btn" onClick={() => void deleteAccountFlow()}>
                Delete account
              </button>
            </div>
          </section>
        </div>
      )}

      <SiteFooter />
    </div>
  );
}
