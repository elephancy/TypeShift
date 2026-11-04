import type { MetadataRoute } from "next";
import { GAME_MODES, MODE_META } from "../src/lib/game-modes";

export default function sitemap(): MetadataRoute.Sitemap {
  const site = "https://typeshift.elfeel.me";
  return [
    { url: `${site}/` },
    { url: `${site}/games` },
    { url: `${site}/boards` },
    { url: `${site}/lab` },
    { url: `${site}/social` },
    ...GAME_MODES.map((mode) => ({ url: `${site}/games/${MODE_META[mode].slug}` })),
  ];
}
