import assert from "node:assert/strict";
import test from "node:test";
import { GAME_MODES, MODE_META } from "./game-modes";
import { isSupportedAppPath } from "./app-routes";

test("supported app routes remain available and nonexistent paths are rejected", () => {
  for (const path of [[], ...["home", "games", "play", "modes", "boards", "social", "lab", "profile", "privacy", "settings"].map((page) => [page]), ...["account", "security", "data", "friends", "duels", "replays", "webhooks", "admin", "sharing"].map((page) => ["profile", page])]) {
    assert.equal(isSupportedAppPath(path), true, path.join("/"));
  }
  for (const mode of GAME_MODES) {
    assert.equal(isSupportedAppPath(["games", MODE_META[mode].slug]), true);
    assert.equal(isSupportedAppPath(["games", mode]), true);
  }
  for (const path of [["missing"], ["games", "missing"], ["profile", "missing"], ["games", "sprint", "extra"], ["boards", "extra"]]) {
    assert.equal(isSupportedAppPath(path), false, path.join("/"));
  }
});
