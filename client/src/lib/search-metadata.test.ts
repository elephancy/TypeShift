import assert from "node:assert/strict";
import test from "node:test";
import { GAME_MODES, MODE_META } from "./game-modes";
import { searchMetadata } from "./search-metadata";
import sitemap from "../../app/sitemap";

test("each published game has distinct metadata and a matching sitemap URL", () => {
  const urls = sitemap().map((entry) => entry.url);
  const titles = new Set<string>();
  for (const mode of GAME_MODES) {
    const game = MODE_META[mode];
    const metadata = searchMetadata(["games", game.slug]);
    assert.equal(metadata.alternates?.canonical, `/games/${game.slug}`);
    assert.ok(urls.includes(`https://typeshift.elfeel.me/games/${game.slug}`));
    assert.ok(typeof metadata.title === "string" && metadata.title.includes(game.label));
    assert.ok(typeof metadata.description === "string" && metadata.description.includes(game.flavor));
    titles.add(metadata.title);
  }
  assert.equal(titles.size, GAME_MODES.length);
  assert.equal(new Set(urls).size, urls.length);
});

test("private account surfaces are excluded and the game index aliases agree", () => {
  assert.equal(searchMetadata([]).alternates?.canonical, "/");
  assert.equal(searchMetadata(["home"]).alternates?.canonical, "/");
  assert.equal(searchMetadata(["boards"]).alternates?.canonical, "/boards");
  assert.equal(searchMetadata(["boards"]).title, "Typing Game Leaderboards | TypeShift");
  assert.deepEqual(searchMetadata(["profile"]).robots, { index: false, follow: true });
  for (const page of ["account", "security", "data", "friends", "duels", "replays", "webhooks", "admin", "sharing"]) {
    assert.deepEqual(searchMetadata(["profile", page]).robots, { index: false, follow: true });
  }
  for (const page of ["games", "play", "modes"]) {
    assert.equal(searchMetadata([page]).alternates?.canonical, "/games");
  }
  assert.deepEqual(searchMetadata(["games", "unrecognized"]), {});
});
