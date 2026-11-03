import { modeFromSlug } from "./game-modes";

const rootPages = new Set(["home", "games", "play", "modes", "boards", "social", "lab", "profile", "privacy", "settings"]);
const profilePages = new Set(["account", "security", "data", "friends", "duels", "replays", "webhooks", "admin", "sharing"]);

export function isSupportedAppPath(slug: string[]): boolean {
  if (slug.length === 0) return true;
  if (slug.length === 1) return rootPages.has(slug[0] ?? "");
  if (slug.length !== 2) return false;
  if (slug[0] === "games") return modeFromSlug(slug[1] ?? "") !== null;
  if (slug[0] === "profile") return profilePages.has(slug[1] ?? "");
  return false;
}
