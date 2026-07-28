import {
  MAX_PLAYER_SELECTIONS,
  isSamePlayerSelection,
  playerSelectionIndex,
  toSelectionApiPayload,
  togglePlayerSelection,
  type PlayerSelection
} from "../lib/player-selections";

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const selection = (
  frameKey: string,
  trackId: string,
  timeSec: number | null = 10
): PlayerSelection => ({
  frame: { key: frameKey, timeSec },
  track: {
    trackId,
    tier: "PRIMARY",
    bbox: { x: 0.1, y: 0.2, w: 0.1, h: 0.2 }
  }
});

const first = selection("frame-1", "1", 0);
const second = selection("frame-2", "2", 30);
assert(isSamePlayerSelection(first, selection("frame-1", "1", 0)), "same selection");
assert(!isSamePlayerSelection(first, second), "different selection");

let current = togglePlayerSelection([], first);
assert(current.length === 1, "adds first anchor");
current = togglePlayerSelection(current, second);
assert(current.length === 2, "adds second anchor");
assert(playerSelectionIndex(current, second) === 1, "preserves primary ordering");
current = togglePlayerSelection(current, second);
assert(current.length === 1, "toggles exact anchor off");

current = togglePlayerSelection(current, selection("frame-1", "99", 0));
assert(current.length === 1 && current[0].track.trackId === "99", "replaces one track per frame");

current = Array.from({ length: MAX_PLAYER_SELECTIONS }, (_, index) =>
  selection(`frame-${index}`, `${index}`, index * 10)
);
const capped = togglePlayerSelection(current, selection("frame-extra", "extra", 99));
assert(capped.length === MAX_PLAYER_SELECTIONS, "caps anchors at five");
assert(capped !== current, "returns immutable copy when capped");

const payload = toSelectionApiPayload(first);
assert(payload.frame_time_sec === 0, "preserves zero timestamp");
assert(payload.frame_key === "frame-1", "maps frame key");

let rejectedNullTime = false;
try {
  toSelectionApiPayload(selection("frame-null", "1", null));
} catch {
  rejectedNullTime = true;
}
assert(rejectedNullTime, "rejects missing timestamp");

let rejectedNegativeTime = false;
try {
  toSelectionApiPayload(selection("frame-negative", "1", -0.01));
} catch {
  rejectedNegativeTime = true;
}
assert(rejectedNegativeTime, "rejects negative timestamp");

let rejectedEmptyFrameKey = false;
try {
  toSelectionApiPayload(selection("   ", "1", 1));
} catch {
  rejectedEmptyFrameKey = true;
}
assert(rejectedEmptyFrameKey, "rejects empty frame key");

let rejectedEmptyTrackId = false;
try {
  toSelectionApiPayload(selection("frame-1", "   ", 1));
} catch {
  rejectedEmptyTrackId = true;
}
assert(rejectedEmptyTrackId, "rejects empty track id");

console.log("player-selections: all tests passed");
