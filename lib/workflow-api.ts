export type JsonRecord = Record<string, unknown>;

export type BoundingBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PreviewTrack = {
  trackId: string;
  tier: string | null;
  score: number | null;
  bbox: BoundingBox;
};

export type PreviewFrame = {
  key: string;
  timeSec: number | null;
  url: string;
  width: number | null;
  height: number | null;
  tracks: PreviewTrack[];
};

export type JobProgress = {
  step: string | null;
  phase: string | null;
  pct: number;
  message: string | null;
  updatedAt: string | null;
  stats: {
    framesTotal: number | null;
    framesUsed: number | null;
    detections: number | null;
    tracklets: number | null;
  };
};

export type JobClip = {
  label: string;
  url: string;
  startSec: number | null;
  endSec: number | null;
};

export type JobResult = {
  overallScore: number | null;
  matchRating10: number | null;
  impact100: number | null;
  roleScore: number | null;
  radar: Record<string, number>;
  explanation: string | null;
  evidence: JsonRecord;
  raw: JsonRecord;
};

export type AnalysisJob = {
  id: string;
  status: string;
  category: string | null;
  role: string | null;
  progress: JobProgress;
  framesProcessed: number | null;
  previewFrames: PreviewFrame[];
  playerSaved: boolean;
  targetSaved: boolean;
  target: JsonRecord | null;
  result: JobResult | null;
  clips: JobClip[];
  videoUrl: string | null;
  warnings: string[];
  error: string | null;
  failureReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CreateJobInput = {
  source: string;
  sourceMode: "url" | "object";
  bucket?: string;
  role: string;
  category: string;
  teamName: string;
  shirtNumber?: number;
  fullMatchMode?: boolean;
};

export class WorkflowApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: unknown;
  readonly missing: string[];
  readonly allowForce: boolean;

  constructor({
    message,
    status,
    code = "HTTP_ERROR",
    requestId = null,
    details = null,
    missing = [],
    allowForce = false
  }: {
    message: string;
    status: number;
    code?: string;
    requestId?: string | null;
    details?: unknown;
    missing?: string[];
    allowForce?: boolean;
  }) {
    super(message);
    this.name = "WorkflowApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
    this.missing = missing;
    this.allowForce = allowForce;
  }
}

const API_PREFIX = "/api/backend";
const DEFAULT_TIMEOUT_MS = 20_000;

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const asRecord = (value: unknown): JsonRecord => (isRecord(value) ? value : {});

const asString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asBoolean = (value: unknown): boolean => value === true;

const first = <T,>(...values: T[]): T | undefined =>
  values.find((value) => value !== undefined && value !== null);

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

const normalizeBoundingBox = (value: unknown): BoundingBox | null => {
  const source = asRecord(value);
  const x = asNumber(source.x);
  const y = asNumber(source.y);
  const w = asNumber(source.w);
  const h = asNumber(source.h);
  if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) {
    return null;
  }
  const normalizedX = clamp(x);
  const normalizedY = clamp(y);
  return {
    x: normalizedX,
    y: normalizedY,
    w: clamp(w, 0.0001, 1 - normalizedX),
    h: clamp(h, 0.0001, 1 - normalizedY)
  };
};

const normalizeTrack = (value: unknown): PreviewTrack | null => {
  const source = asRecord(value);
  const trackId = first(source.track_id, source.trackId, source.id);
  const bbox = normalizeBoundingBox(
    first(source.bbox, source.bbox_xywh, source.bounding_box, source.boundingBox)
  );
  if (trackId === undefined || trackId === null || !bbox) return null;
  return {
    trackId: String(trackId),
    tier: asString(first(source.tier, source.group, source.category)),
    score: asNumber(first(source.score_hint, source.scoreHint, source.score, source.confidence)),
    bbox
  };
};

const normalizeFrame = (value: unknown): PreviewFrame | null => {
  const source = asRecord(value);
  const key = asString(first(source.key, source.frame_key, source.s3_key, source.s3Key));
  const url = asString(
    first(
      source.signed_url,
      source.signedUrl,
      source.image_url,
      source.imageUrl,
      source.url
    )
  );
  if (!key || !url) return null;

  const rawTracks = first(source.tracks, source.track_overlays, source.candidates);
  const tracks = Array.isArray(rawTracks)
    ? rawTracks.map(normalizeTrack).filter((track): track is PreviewTrack => Boolean(track))
    : [];

  return {
    key,
    timeSec: asNumber(first(source.time_sec, source.timeSec, source.t, source.timestamp)),
    url,
    width: asNumber(first(source.width, source.w)),
    height: asNumber(first(source.height, source.h)),
    tracks
  };
};

const normalizeProgress = (value: unknown): JobProgress => {
  const source = asRecord(value);
  const stats = asRecord(first(source.stats, source.progress_stats));
  const step = asString(source.step);
  const explicitPhase = asString(first(source.phase, source.progress_phase));
  const normalizedStep = step?.toUpperCase() ?? "";
  const inferredPhase = normalizedStep.includes("PREVIEW")
    ? "PREVIEW"
    : normalizedStep.includes("TRACK")
      ? "TRACKING"
      : normalizedStep.includes("FEATURE")
        ? "FEATURES"
        : normalizedStep.includes("SCOR")
          ? "SCORING"
          : normalizedStep.includes("CLIP")
            ? "CLIPS"
            : normalizedStep.includes("DONE") || normalizedStep.includes("COMPLETE")
              ? "FINALIZE"
              : null;

  return {
    step,
    phase: explicitPhase ?? inferredPhase,
    pct: clamp(asNumber(source.pct) ?? 0, 0, 100),
    message: asString(source.message),
    updatedAt: asString(first(source.updated_at, source.updatedAt)),
    stats: {
      framesTotal: asNumber(first(stats.frames_total, stats.framesTotal, source.frames_total)),
      framesUsed: asNumber(
        first(
          stats.frames_used,
          stats.framesUsed,
          stats.sample_frames_count,
          stats.sampleFramesCount,
          source.frames_used
        )
      ),
      detections: asNumber(
        first(stats.detections_count, stats.detectionsCount, source.detections_count)
      ),
      tracklets: asNumber(
        first(
          stats.tracklets_count,
          stats.trackletsCount,
          source.tracklets_count,
          source.totalTracks,
          source.total_tracks
        )
      )
    }
  };
};

const normalizeWarnings = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((warning) => {
      if (typeof warning === "string") return warning.trim();
      const source = asRecord(warning);
      return asString(first(source.message, source.code)) ?? "";
    })
    .filter(Boolean);
};

const normalizeResult = (value: unknown): JobResult | null => {
  const source = asRecord(value);
  if (Object.keys(source).length === 0) return null;
  const summary = asRecord(source.summary);
  const radarSource = asRecord(first(source.radar, source.breakdown));
  const radar = Object.fromEntries(
    Object.entries(radarSource)
      .map(([key, raw]) => [key, asNumber(raw)] as const)
      .filter((entry): entry is [string, number] => entry[1] !== null)
  );

  return {
    overallScore: asNumber(
      first(source.overall_score, source.overallScore, summary.overall_score, summary.overallScore)
    ),
    matchRating10: asNumber(first(source.match_rating_10, source.matchRating10)),
    impact100: asNumber(first(source.impact_100, source.impact100)),
    roleScore: asNumber(
      first(source.role_score, source.roleScore, summary.role_score, summary.roleScore)
    ),
    radar,
    explanation: asString(
      first(source.explain, source.explanation, source.score_explanation, source.scoreExplanation)
    ),
    evidence: asRecord(first(source.evidence_metrics, source.evidenceMetrics, source.metrics)),
    raw: source
  };
};

const normalizeClips = (...values: unknown[]): JobClip[] => {
  const raw = values.find(Array.isArray);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value): JobClip | null => {
      const source = asRecord(value);
      const url = asString(first(source.url, source.signed_url, source.signedUrl));
      if (!url) return null;
      const startSec = asNumber(first(source.start_sec, source.startSec, source.start));
      const endSec = asNumber(first(source.end_sec, source.endSec, source.end));
      return {
        label:
          asString(source.label) ??
          (startSec !== null && endSec !== null ? `${startSec}s–${endSec}s` : "Clip"),
        url,
        startSec,
        endSec
      };
    })
    .filter((clip): clip is JobClip => Boolean(clip));
};

export const normalizeJob = (value: unknown): AnalysisJob => {
  const source = asRecord(value);
  const id = asString(first(source.job_id, source.jobId, source.id));
  if (!id) throw new Error("Backend response is missing job_id.");
  const resultSource = asRecord(source.result);
  const assets = asRecord(first(source.assets, resultSource.assets));
  const rawFrames = first(source.preview_frames, source.previewFrames);
  const previewFrames = Array.isArray(rawFrames)
    ? rawFrames.map(normalizeFrame).filter((frame): frame is PreviewFrame => Boolean(frame))
    : [];

  return {
    id,
    status: asString(source.status)?.toUpperCase() ?? "UNKNOWN",
    category: asString(source.category),
    role: asString(source.role),
    progress: normalizeProgress(source.progress),
    framesProcessed: asNumber(first(source.frames_processed, source.framesProcessed)),
    previewFrames,
    playerSaved:
      asBoolean(first(source.playerSaved, source.player_saved)) ||
      Object.keys(asRecord(first(source.player_ref, source.playerRef))).length > 0,
    targetSaved:
      asBoolean(first(source.targetSaved, source.target_saved)) ||
      asBoolean(asRecord(source.target).confirmed),
    target: Object.keys(asRecord(source.target)).length > 0 ? asRecord(source.target) : null,
    result: normalizeResult(resultSource),
    clips: normalizeClips(assets.clips, resultSource.clips),
    videoUrl: asString(
      first(
        source.video_url,
        source.videoUrl,
        assets.inputVideoUrl,
        assets.input_video_url
      )
    ),
    warnings: normalizeWarnings(first(source.warnings, resultSource.warnings)),
    error: asString(source.error),
    failureReason: asString(first(source.failure_reason, source.failureReason)),
    createdAt: asString(first(source.created_at, source.createdAt)),
    updatedAt: asString(first(source.updated_at, source.updatedAt))
  };
};

const readJson = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await response.text();
    return text ? { message: text } : {};
  }
  return response.json().catch(() => ({}));
};

const request = async <T,>(
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_PREFIX}${path}`, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers
      }
    });
    const payload = await readJson(response);
    const envelope = asRecord(payload);
    const meta = asRecord(envelope.meta);
    const errorSource = asRecord(first(envelope.error, asRecord(envelope.detail).error));
    const ok = response.ok && envelope.ok !== false;

    if (!ok) {
      const details = first(errorSource.details, asRecord(envelope.detail).details);
      const missingRaw = first(
        errorSource.missing,
        asRecord(details).missing,
        asRecord(envelope.detail).missing
      );
      const missing = Array.isArray(missingRaw)
        ? missingRaw.filter((item): item is string => typeof item === "string")
        : [];
      throw new WorkflowApiError({
        status: response.status,
        code: asString(first(errorSource.code, envelope.code)) ?? "HTTP_ERROR",
        message:
          asString(
            first(
              errorSource.message,
              envelope.message,
              asRecord(envelope.detail).message
            )
          ) ?? `Request failed (${response.status})`,
        requestId:
          asString(
            first(
              meta.request_id,
              envelope.request_id,
              response.headers.get("x-request-id")
            )
          ) ?? null,
        details,
        missing,
        allowForce: asBoolean(first(errorSource.allow_force, errorSource.allowForce))
      });
    }

    return first(envelope.data, payload) as T;
  } catch (error) {
    if (error instanceof WorkflowApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new WorkflowApiError({
        status: 408,
        code: "REQUEST_TIMEOUT",
        message: "Il backend non ha risposto in tempo. Riprova."
      });
    }
    throw new WorkflowApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: error instanceof Error ? error.message : "Errore di rete inatteso."
    });
  } finally {
    window.clearTimeout(timeout);
  }
};

export const createJob = async (input: CreateJobInput): Promise<AnalysisJob> => {
  const payload: JsonRecord = {
    role: input.role.trim(),
    category: input.category.trim(),
    team_name: input.teamName.trim(),
    full_match_mode: Boolean(input.fullMatchMode)
  };
  if (input.shirtNumber !== undefined) payload.shirt_number = input.shirtNumber;
  if (input.sourceMode === "url") {
    payload.video_url = input.source.trim();
  } else {
    payload.video_key = input.source.trim();
    payload.video_bucket = input.bucket?.trim();
  }
  const created = await request<JsonRecord>("/jobs", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const id = asString(first(created.job_id, created.jobId, created.id));
  if (!id) throw new Error("Create-job response is missing job_id.");
  return getJob(id);
};

export const getJob = async (jobId: string): Promise<AnalysisJob> =>
  normalizeJob(await request<unknown>(`/jobs/${encodeURIComponent(jobId)}`));

export const getFrames = async (jobId: string, count = 32): Promise<PreviewFrame[]> => {
  const payload = await request<JsonRecord>(
    `/jobs/${encodeURIComponent(jobId)}/frames?count=${count}`
  );
  const items = payload.items;
  if (!Array.isArray(items)) return [];
  return items.map(normalizeFrame).filter((frame): frame is PreviewFrame => Boolean(frame));
};

export const pickPlayer = async (
  jobId: string,
  frameKey: string,
  trackId: string
): Promise<void> => {
  await request(`/jobs/${encodeURIComponent(jobId)}/pick-player`, {
    method: "POST",
    body: JSON.stringify({ frame_key: frameKey, track_id: trackId })
  });
};

export const confirmTarget = async (
  jobId: string,
  selection: { frame: PreviewFrame; track: PreviewTrack; force?: boolean }
): Promise<void> => {
  await request(`/jobs/${encodeURIComponent(jobId)}/target`, {
    method: "POST",
    body: JSON.stringify({
      frame_key: selection.frame.key,
      time_sec: selection.frame.timeSec,
      track_id: selection.track.trackId,
      bbox: selection.track.bbox,
      force: Boolean(selection.force)
    })
  });
};

export const enqueueJob = async (jobId: string): Promise<void> => {
  await request(`/jobs/${encodeURIComponent(jobId)}/enqueue`, {
    method: "POST",
    body: "{}"
  });
};

export const isFramesNotReadyError = (error: unknown) =>
  error instanceof WorkflowApiError &&
  (error.code === "FRAMES_NOT_READY" || error.status === 409);
