export const MAX_PLAYER_SELECTIONS = 5;

export type SelectionBoundingBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PlayerSelection = {
  frame: {
    key: string;
    timeSec: number | null;
  };
  track: {
    trackId: string;
    bbox: SelectionBoundingBox;
    tier?: string | null;
  };
};

export type SelectionApiPayload = {
  frame_key: string;
  frame_time_sec: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export const isSamePlayerSelection = (
  left: PlayerSelection,
  right: PlayerSelection
) =>
  left.frame.key === right.frame.key &&
  left.track.trackId === right.track.trackId;

export const playerSelectionIndex = (
  selections: readonly PlayerSelection[],
  candidate: PlayerSelection
) => selections.findIndex((item) => isSamePlayerSelection(item, candidate));

export const togglePlayerSelection = (
  selections: readonly PlayerSelection[],
  candidate: PlayerSelection
): PlayerSelection[] => {
  const exactIndex = playerSelectionIndex(selections, candidate);
  if (exactIndex >= 0) {
    return selections.filter((_, index) => index !== exactIndex);
  }

  const sameFrameIndex = selections.findIndex(
    (item) => item.frame.key === candidate.frame.key
  );
  if (sameFrameIndex >= 0) {
    return selections.map((item, index) =>
      index === sameFrameIndex ? candidate : item
    );
  }

  if (selections.length >= MAX_PLAYER_SELECTIONS) {
    return [...selections];
  }
  return [...selections, candidate];
};

export const toSelectionApiPayload = (
  selection: PlayerSelection
): SelectionApiPayload => {
  if (
    selection.frame.timeSec === null ||
    !Number.isFinite(selection.frame.timeSec) ||
    selection.frame.timeSec < 0
  ) {
    throw new Error("Il frame selezionato non ha un timestamp valido.");
  }
  if (!selection.frame.key.trim()) {
    throw new Error("Il frame selezionato non ha una chiave valida.");
  }
  if (!selection.track.trackId.trim()) {
    throw new Error("Il giocatore selezionato non ha un identificativo valido.");
  }
  const { x, y, w, h } = selection.track.bbox;
  const numbers = [x, y, w, h];
  if (!numbers.every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0) {
    throw new Error("Il riquadro del giocatore non è valido.");
  }
  if (x + w > 1.000001 || y + h > 1.000001) {
    throw new Error("Il riquadro del giocatore esce dal frame.");
  }
  return {
    frame_key: selection.frame.key,
    frame_time_sec: selection.frame.timeSec,
    x,
    y,
    w,
    h
  };
};
