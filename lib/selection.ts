export type NormalizedBBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type UnknownRecord = Record<string, any>;

export const coerceNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const getSelectionTimeSec = (source: unknown): number | null => {
  if (!source || typeof source !== "object") {
    return null;
  }
  const record = source as UnknownRecord;
  return coerceNumber(
    record.timeSec ??
      record.time_sec ??
      record.frameTimeSec ??
      record.frame_time_sec ??
      record.t ??
      record.sample_time_sec ??
      record.sampleTimeSec
  );
};

export const getSelectionFrameKey = (source: unknown): string | null => {
  if (!source || typeof source !== "object") {
    return null;
  }
  const record = source as UnknownRecord;
  const key =
    record.frameKey ??
    record.frame_key ??
    record.key ??
    record.s3_key ??
    record.s3Key ??
    null;
  if (typeof key === "string" && key.trim()) {
    return key;
  }
  return null;
};

export const getSelectionBBox = (source: unknown): NormalizedBBox | null => {
  if (!source || typeof source !== "object") {
    return null;
  }
  const record = source as UnknownRecord;
  const bboxSource =
    record.bbox_xywh ??
    record.bbox ??
    record.box ??
    record.bounding_box ??
    record.boundingBox ??
    record.selection ??
    record.target ??
    null;
  const x = coerceNumber(record.x ?? bboxSource?.x);
  const y = coerceNumber(record.y ?? bboxSource?.y);
  const w = coerceNumber(record.w ?? bboxSource?.w);
  const h = coerceNumber(record.h ?? bboxSource?.h);
  if (x === null || y === null || w === null || h === null) {
    return null;
  }
  return { x, y, w, h };
};

export const normalizeSelectionInput = (source: unknown) => {
  return {
    frameKey: getSelectionFrameKey(source),
    timeSec: getSelectionTimeSec(source),
    bbox: getSelectionBBox(source)
  };
};

export const clampNormalized = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));
