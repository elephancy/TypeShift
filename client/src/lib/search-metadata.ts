import type { Metadata } from "next";
import { MODE_META, modeFromSlug } from "./game-modes";

export function searchMetadata(slug: string[]): Metadata {
  if (slug.length === 0 || (slug.length === 1 && slug[0] === "home")) {
    return { alternates: { canonical: "/" } };
  }
  if (slug.length === 1 && slug[0] === "boards") {
    return {
      title: "Typing Game Leaderboards | TypeShift",
      description: "Explore TypeShift's global typing runs, daily challenge rankings and current season ladder.",
      alternates: { canonical: "/boards" },
    };
  }
  if (slug[0] === "profile") {
    return { title: slug[1] === "account" ? "Account | TypeShift" : "Profile | TypeShift", robots: { index: false, follow: true } };
  }
  if (slug.length === 2 && slug[0] === "games") {
    const mode = modeFromSlug(slug[1] ?? "");
    if (mode) {
      const game = MODE_META[mode];
      return {
        title: `${game.label} Typing Game | TypeShift`,
        description: `${game.flavor} ${game.objective} ${game.rule}`,
        alternates: { canonical: `/games/${game.slug}` },
      };
    }
  }
  if (slug.length === 1 && ["games", "play", "modes"].includes(slug[0] ?? "")) {
    return {
      title: "Typing Games and Practice Modes | TypeShift",
      description: "Explore TypeShift's typing games, from timed word sprints to quote practice, arcade challenges, rhythm and more.",
      alternates: { canonical: "/games" },
    };
  }
  return {};
}
