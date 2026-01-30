type CreateJobVideoPayload =
  | {
      video_url: string;
      video_key?: never;
      video_bucket?: never;
    }
  | {
      video_key: string;
      video_bucket: string;
      video_url?: never;
    };

export type CreateJobPayload = CreateJobVideoPayload & {
  role: string;
  category: string;
  shirt_number?: number;
  team_name?: string;
};

export type JobStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED"
  | "WAITING_FOR_SELECTION"
  | "WAITING_FOR_PLAYER"
  | string;

export type JobProgress = {
  pct?: number;
  step?: string;
  message?: string;
  updatedAt?: string;
  autodetection_status?: string;
  autodetectionStatus?: string;
  totalTracks?: number;
  total_tracks?: number;
  error_detail?: string;
  errorDetail?: string;
};

export type JobResultSummary = {
  playerRole?: string;
  overallScore?: number;
};

export type JobAssetVideo = {
  s3Key?: string;
  signedUrl?: string;
  expiresIn?: number;
};

export type JobClip = {
  index?: number;
  start?: number;
  end?: number;
  s3Key?: string;
  signedUrl?: string;
  expiresIn?: number;
};

export type PreviewFrame = {
  timeSec: number | null;
  key: string;
  url?: string;
  signedUrl?: string;
  width?: number | null;
  height?: number | null;
  tracks?: PreviewFrameTrack[];
};

export type PreviewFrameTrack = {
  trackId: string;
  tier?: string | null;
  scoreHint?: number | null;
  x?: number | null;
  y?: number | null;
  w?: number | null;
  h?: number | null;
};

export type OverlayFramesResponse = {
  frames: PreviewFrame[];
  overlayReady: boolean | null;
};

export type FrameItem = {
  name: string;
  url: string;
  key: string;
  width?: number | null;
  height?: number | null;
  time_sec?: number | null;
};

export type JobResult = {
  schema_version?: string;
  summary?: JobResultSummary;
  radar?: Record<string, number>;
  assets?: {
    inputVideo?: JobAssetVideo;
    inputVideoUrl?: string;
    input_video_url?: string;
    input_video?: JobAssetVideo;
    clips?: JobClip[];
  };
  clips?: JobClip[];
  previewFrames?: PreviewFrame[];
  warnings?: unknown[];
  [key: string]: any;
};

export type JobResponse = {
  jobId?: string;
  status?: JobStatus;
  progress?: JobProgress;
  autodetection_status?: string;
  autodetectionStatus?: string;
  error_detail?: string;
  errorDetail?: string;
  previewFrames?: PreviewFrame[];
  result?: JobResult;
  playerRef?: FrameSelection;
  playerRefRaw?: unknown;
  target?: JobTarget;
  error?: string;
  warnings?: unknown[];
  createdAt?: string;
  updatedAt?: string;
  videoUrl?: string;
  teamName?: string;
};

export type JobFrame = {
  t: number;
  url: string;
  w: number;
  h: number;
};

export type JobFrameListResponse = {
  items: JobFrame[];
};

export type FrameSelection = {
  frameTimeSec: number | null;
  frame_time_sec?: number | null;
  t?: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type TargetSelection = {
  frameTimeSec: number | null;
  frame_time_sec?: number | null;
  frame_key?: string | null;
  frameKey?: string | null;
  trackId?: string | null;
  track_id?: string | null;
  t?: number | null;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type JobTarget = {
  selections?: TargetSelection[];
  [key: string]: any;
};

export type TrackCandidateSampleFrame = {
  imageUrl?: string | null;
  frameTimeSec?: number | null;
  frame_time_sec?: number | null;
  frameKey?: string | null;
  frame_key?: string | null;
  x?: number | null;
  y?: number | null;
  w?: number | null;
  h?: number | null;
};

export type TrackCandidate = {
  trackId: string;
  coverage?: number | null;
  stability?: number | null;
  avgBoxArea?: number | null;
  thumbnailUrl?: string | null;
  tier?: string | null;
  frameTimeSec?: number | null;
  frame_time_sec?: number | null;
  t?: number | null;
  x?: number | null;
  y?: number | null;
  w?: number | null;
  h?: number | null;
  sampleFrames?: TrackCandidateSampleFrame[];
};

export type TrackCandidatesResponse = {
  candidates: TrackCandidate[];
  fallbackCandidates: TrackCandidate[];
};

type UnknownRecord = Record<string, any>;

const jsonHeaders = {
  "Content-Type": "application/json"
};

const DEFAULT_TIMEOUT_MS = 15000;

const coerceNumber = (value: unknown): number | null => {
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

const toJsonBody = (payload?: unknown) => JSON.stringify(payload ?? {});

const unwrap = <T,>(payload: unknown): T => {
  if (payload && typeof payload === "object" && "ok" in payload && "data" in payload) {
    return (payload as { data?: T }).data as T;
  }
  return payload as T;
};

const mapPreviewFrameTrack = (track: UnknownRecord): PreviewFrameTrack => {
  const trackId =
    String(
      track.trackId ??
        track.track_id ??
        track.id ??
        track.track ??
        ""
    ) || "unknown";
  const tier =
    track.tier ??
    track.group ??
    track.section ??
    track.category ??
    track.bucket ??
    track.segment ??
    null;
  const scoreHint = coerceNumber(
    track.score_hint ??
      track.scoreHint ??
      track.score ??
      track.confidence ??
      null
  );
  const bboxSource =
    track.bbox_xywh ??
    track.bbox ??
    track.box ??
    track.bounding_box ??
    track.boundingBox ??
    null;
  const x = coerceNumber(bboxSource?.x ?? track.x);
  const y = coerceNumber(bboxSource?.y ?? track.y);
  const w = coerceNumber(bboxSource?.w ?? track.w);
  const h = coerceNumber(bboxSource?.h ?? track.h);

  return {
    trackId,
    tier,
    scoreHint,
    x,
    y,
    w,
    h
  };
};

const mapPreviewFrame = (frame: UnknownRecord): PreviewFrame => {
  const timeSec = coerceNumber(
    frame.timeSec ?? frame.time_sec ?? frame.timestamp ?? frame.t
  );
  const key =
    frame.key ??
    frame.frame_key ??
    frame.s3_key ??
    frame.s3Key ??
    `frame-${timeSec}`;
  const signedUrl = frame.signedUrl ?? frame.signed_url ?? null;
  const imageUrl =
    frame.imageUrl ??
    frame.image_url ??
    frame.url ??
    frame.public_url ??
    frame.publicUrl ??
    null;
  const bucket = frame.bucket ?? frame.s3_bucket ?? frame.s3Bucket ?? null;
  const isPublic =
    frame.is_public ??
    frame.isPublic ??
    frame.public ??
    frame.publicly_accessible ??
    frame.publiclyAccessible ??
    false;
  const publicUrl =
    !signedUrl && !imageUrl && isPublic && bucket && key
      ? `https://${bucket}.s3.amazonaws.com/${key}`
      : null;
  const url = imageUrl ?? publicUrl ?? signedUrl ?? "";
  const width = frame.width ?? frame.w ?? null;
  const height = frame.height ?? frame.h ?? null;

  const tracksSource =
    frame.tracks ??
    frame.track_overlays ??
    frame.overlay_tracks ??
    frame.overlayTracks ??
    frame.trackOverlays ??
    frame.track_candidates ??
    frame.candidates ??
    null;
  const tracks = Array.isArray(tracksSource)
    ? tracksSource.map((track) =>
        track && typeof track === "object"
          ? mapPreviewFrameTrack(track as UnknownRecord)
          : null
      )
    : null;
  const filteredTracks = tracks?.filter(Boolean) as PreviewFrameTrack[] | null;

  return {
    ...frame,
    timeSec,
    key,
    url,
    signedUrl: signedUrl ?? undefined,
    width,
    height,
    tracks: filteredTracks ?? undefined
  };
};

const mapFrameListItem = (frame: UnknownRecord): FrameItem => {
  const timeSec = coerceNumber(
    frame.timeSec ?? frame.time_sec ?? frame.timestamp ?? frame.t
  );
  const key =
    frame.key ?? frame.frame_key ?? frame.s3_key ?? `frame-${timeSec ?? 0}`;
  const url =
    frame.signedUrl ??
    frame.signed_url ??
    frame.imageUrl ??
    frame.image_url ??
    frame.url ??
    "";
  const width = frame.width ?? frame.w ?? null;
  const height = frame.height ?? frame.h ?? null;
  const name = frame.name ?? frame.filename ?? key;

  return {
    name,
    url,
    key,
    width,
    height,
    time_sec: timeSec
  };
};

export const normalizePreviewFrames = (frames: unknown): PreviewFrame[] => {
  if (!Array.isArray(frames)) {
    return [];
  }

  return frames.map(mapPreviewFrame);
};

const normalizeFrameListItems = (frames: unknown): FrameItem[] => {
  if (!Array.isArray(frames)) {
    return [];
  }

  return frames.map(mapFrameListItem).filter((frame) => Boolean(frame.url));
};

const normalizePlayerRef = (raw: unknown): FrameSelection | null => {
  if (!raw) {
    return null;
  }

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as UnknownRecord;
      return normalizePlayerRef(parsed);
    } catch {
      return null;
    }
  }

  if (typeof raw === "object" && "x" in raw && "y" in raw) {
    const source = raw as UnknownRecord;
    const frameTimeSec = coerceNumber(
      source.frameTimeSec ??
        source.frame_time_sec ??
        source.t ??
        source.time_sec ??
        source.timeSec
    );
    return {
      frameTimeSec,
      t: coerceNumber(source.t ?? frameTimeSec) ?? undefined,
      x: source.x ?? 0,
      y: source.y ?? 0,
      w: source.w ?? 0,
      h: source.h ?? 0
    };
  }

  return null;
};

const mapTargetSelection = (selection: UnknownRecord): TargetSelection => {
  const frameTimeSec = coerceNumber(
    selection.frameTimeSec ??
      selection.frame_time_sec ??
      selection.t ??
      selection.time_sec ??
      selection.timeSec
  );
  const frameKey =
    selection.frameKey ?? selection.frame_key ?? selection.key ?? null;
  return {
    frameTimeSec,
    frame_time_sec: frameTimeSec,
    frameKey,
    frame_key: frameKey,
    t: frameTimeSec ?? selection.t ?? null,
    x: selection.x ?? 0,
    y: selection.y ?? 0,
    w: selection.w ?? 0,
    h: selection.h ?? 0
  };
};

const mapTrackCandidateSampleFrame = (
  sample: UnknownRecord
): TrackCandidateSampleFrame => {
  const frameTimeSec = coerceNumber(
    sample.frameTimeSec ??
      sample.frame_time_sec ??
      sample.t ??
      sample.time_sec ??
      sample.timeSec ??
      sample.sample_time_sec ??
      sample.sampleTimeSec
  );
  const frameKey = sample.frameKey ?? sample.frame_key ?? sample.key ?? null;
  const bboxSource =
    sample.bbox_xywh ??
    sample.bbox ??
    sample.box ??
    sample.bounding_box ??
    sample.boundingBox ??
    null;
  const x = coerceNumber(bboxSource?.x ?? sample.x);
  const y = coerceNumber(bboxSource?.y ?? sample.y);
  const w = coerceNumber(bboxSource?.w ?? sample.w);
  const h = coerceNumber(bboxSource?.h ?? sample.h);
  const imageUrl =
    sample.imageUrl ??
    sample.image_url ??
    sample.frameUrl ??
    sample.frame_url ??
    sample.thumbnailUrl ??
    sample.thumbnail_url ??
    null;
  return {
    imageUrl,
    frameTimeSec,
    frame_time_sec: frameTimeSec,
    frameKey,
    frame_key: frameKey,
    x,
    y,
    w,
    h
  };
};

const mapTrackCandidate = (candidate: UnknownRecord): TrackCandidate => {
  const sampleFramesSource =
    candidate.sampleFrames ??
    candidate.sample_frames ??
    candidate.samples ??
    candidate.frames ??
    [];
  const sampleFrames = Array.isArray(sampleFramesSource) ? sampleFramesSource : [];
  const sampleFramesNormalized = sampleFrames
    .filter((sample) => sample && typeof sample === "object")
    .map((sample) => mapTrackCandidateSampleFrame(sample as UnknownRecord));
  const primarySample =
    sampleFramesNormalized.length > 0 ? sampleFramesNormalized[0] ?? null : null;
  const trackId =
    String(
      candidate.trackId ??
        candidate.track_id ??
        candidate.id ??
        candidate.track ??
        ""
    ) || "unknown";
  const coverage = coerceNumber(candidate.coverage ?? candidate.coverage_pct);
  const stability = coerceNumber(candidate.stability ?? candidate.stability_score);
  const avgBoxArea = coerceNumber(
    candidate.avgBoxArea ??
      candidate.avg_box_area ??
      candidate.avg_box ??
      candidate.avg_box_area_pct
  );
  const thumbnailUrl =
    candidate.thumbnailUrl ??
    candidate.thumbnail_url ??
    candidate.sampleUrl ??
    candidate.sample_url ??
    candidate.frameUrl ??
    candidate.frame_url ??
    candidate.imageUrl ??
    candidate.image_url ??
    primarySample?.imageUrl ??
    null;
  const tier =
    candidate.tier ??
    candidate.group ??
    candidate.section ??
    candidate.category ??
    candidate.bucket ??
    candidate.segment ??
    null;
  const bboxSource =
    candidate.bbox_xywh ??
    candidate.bbox ??
    candidate.box ??
    candidate.bounding_box ??
    candidate.boundingBox ??
    primarySample ?? null;
  const frameTimeSec = coerceNumber(
    candidate.frameTimeSec ??
      candidate.frame_time_sec ??
      candidate.time_sec ??
      candidate.timeSec ??
      candidate.t ??
      candidate.sample_time_sec ??
      candidate.sampleTimeSec ??
      primarySample?.frameTimeSec ??
      primarySample?.frame_time_sec
  );
  const x = coerceNumber(bboxSource?.x ?? candidate.x ?? primarySample?.x);
  const y = coerceNumber(bboxSource?.y ?? candidate.y ?? primarySample?.y);
  const w = coerceNumber(bboxSource?.w ?? candidate.w ?? primarySample?.w);
  const h = coerceNumber(bboxSource?.h ?? candidate.h ?? primarySample?.h);

  return {
    trackId,
    coverage,
    stability,
    avgBoxArea,
    thumbnailUrl,
    tier,
    frameTimeSec,
    frame_time_sec: frameTimeSec,
    t: frameTimeSec,
    x,
    y,
    w,
    h,
    sampleFrames: sampleFramesNormalized
  };
};

const normalizeTrackCandidates = (payload: unknown): TrackCandidatesResponse => {
  if (!payload) {
    return { candidates: [], fallbackCandidates: [] };
  }
  const source = Array.isArray(payload)
    ? payload
    : (payload as UnknownRecord).items ??
      (payload as UnknownRecord).candidates ??
      (payload as UnknownRecord).tracks ??
      [];
  const fallbackSource = Array.isArray(payload)
    ? []
    : (payload as UnknownRecord).fallback_candidates ??
      (payload as UnknownRecord).fallbackCandidates ??
      (payload as UnknownRecord).best_matches ??
      (payload as UnknownRecord).bestMatches ??
      (payload as UnknownRecord).fallback ??
      [];

  const candidates = Array.isArray(source)
    ? source.map(mapTrackCandidate).filter((candidate) => Boolean(candidate.trackId))
    : [];
  const fallbackCandidates = Array.isArray(fallbackSource)
    ? fallbackSource
        .map(mapTrackCandidate)
        .filter((candidate) => Boolean(candidate.trackId))
    : [];

  return { candidates, fallbackCandidates };
};

const mapJobResponse = (job: UnknownRecord): JobResponse => {
  const result = job.result as UnknownRecord | undefined;
  const previewFramesSource =
    result?.previewFrames ??
    result?.preview_frames ??
    job.previewFrames ??
    job.preview_frames ??
    [];
  const previewFrames = normalizePreviewFrames(previewFramesSource);

  return {
    ...job,
    previewFrames,
    result: result
      ? {
          ...result,
          previewFrames
        }
      : result
  };
};

export const normalizeJob = (payload: unknown): JobResponse => {
  const normalized =
    payload && typeof payload === "object" && "data" in payload
      ? (payload as { data?: UnknownRecord }).data ?? {}
      : (payload as UnknownRecord);
  const data = normalized ?? {};
  const progressSource = data.progress as UnknownRecord | undefined;
  const playerRef = data.player_ref ?? data.playerRef ?? null;
  const inputVideoUrl = data.assets?.inputVideoUrl ?? data.video_url ?? null;
  const previewFrames = data.preview_frames ?? data.previewFrames ?? [];
  const normalizedPlayerRef = normalizePlayerRef(playerRef);
  const rawTarget = data.target ?? data.data?.target ?? null;
  const targetSelectionsSource = rawTarget?.selections ?? null;
  const targetSelections = Array.isArray(targetSelectionsSource)
    ? targetSelectionsSource.map(mapTargetSelection)
    : [];
  const target =
    rawTarget && typeof rawTarget === "object"
      ? {
          ...rawTarget,
          selections: targetSelections
        }
      : null;
  const resultSource = data.result as UnknownRecord | undefined;
  const assetsSource = resultSource?.assets ?? {};
  const mergedAssets = {
    ...data.assets,
    ...assetsSource,
    inputVideoUrl:
      assetsSource.inputVideoUrl ??
      assetsSource.input_video_url ??
      data.assets?.inputVideoUrl ??
      data.video_url ??
      null,
    input_video_url:
      assetsSource.input_video_url ??
      assetsSource.inputVideoUrl ??
      data.assets?.inputVideoUrl ??
      data.video_url ??
      null
  };
  const shouldIncludeResultAssets = resultSource || data.assets || inputVideoUrl;
  const result = shouldIncludeResultAssets
    ? {
        ...(resultSource ?? {}),
        assets: mergedAssets
      }
    : resultSource;
  const mapped: UnknownRecord = {
    ...data,
    createdAt: data.createdAt ?? data.created_at ?? null,
    updatedAt: data.updatedAt ?? data.updated_at ?? null,
    playerRef: normalizedPlayerRef,
    playerRefRaw: playerRef,
    target,
    previewFrames,
    result,
    progress: progressSource
      ? {
          ...progressSource,
          updatedAt: progressSource.updatedAt ?? progressSource.updated_at ?? null
        }
      : data.progress
  };
  return mapJobResponse(mapped);
};

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
) {
  const controller = new AbortController();
  const { signal, ...restInit } = init;

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...restInit, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

const extractDetailMessage = (detail: unknown) => {
  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object") {
          if ("msg" in item && typeof item.msg === "string") {
            return item.msg;
          }
          if ("message" in item && typeof item.message === "string") {
            return item.message;
          }
          return JSON.stringify(item);
        }
        return String(item);
      })
      .filter(Boolean);
    return messages.length ? messages.join("; ") : null;
  }

  if (detail && typeof detail === "object" && "message" in detail) {
    const message = detail.message;
    if (typeof message === "string") {
      return message;
    }
  }

  return null;
};

async function handleError(response: Response) {
  let message = "";
  let requestId: string | null = null;
  let errorCode: string | null = null;
  let allowForce: boolean | null = null;

  try {
    const data = await response.clone().json();
    requestId =
      data?.request_id ??
      data?.requestId ??
      data?.detail?.request_id ??
      data?.detail?.requestId ??
      null;
    const missingFieldsSource =
      data?.missing ??
      data?.detail?.missing ??
      data?.error?.missing ??
      null;
    const missingFields = Array.isArray(missingFieldsSource)
      ? missingFieldsSource.filter((field) => typeof field === "string")
      : [];
    if (missingFields.length > 0) {
      message = `Manca: ${missingFields.join(", ")}`;
    }
    const detailMessage = extractDetailMessage(data?.detail);
    errorCode =
      data?.code ??
      data?.error_code ??
      data?.detail?.code ??
      data?.detail?.error_code ??
      null;
    const allowForceRaw =
      data?.allow_force ??
      data?.allowForce ??
      data?.detail?.allow_force ??
      data?.detail?.allowForce ??
      null;
    allowForce =
      typeof allowForceRaw === "boolean" ? allowForceRaw : allowForce ?? null;
    message =
      detailMessage ??
      (typeof data?.error === "string" ? data.error : data?.error?.message) ??
      data?.progress?.message ??
      data?.message ??
      message ??
      null;
  } catch {
    // ignore json parsing errors
  }

  if (!message) {
    try {
      const text = await response.text();
      if (text) {
        message = text;
      }
    } catch {
      // ignore text parsing errors
    }
  }

  if (!message) {
    message = response.statusText || "Unexpected error";
  }

  if (requestId) {
    console.warn("API request_id", requestId);
  }
  const error = new Error(message);
  (error as Error & { status?: number }).status = response.status;
  if (errorCode) {
    (error as Error & { code?: string }).code = errorCode;
  }
  if (requestId) {
    (error as Error & { requestId?: string }).requestId = requestId;
  }
  if (allowForce !== null) {
    (error as Error & { allowForce?: boolean }).allowForce = allowForce;
  }
  throw error;
}

export async function createJob(payload: CreateJobPayload) {
  const response = await fetchWithTimeout("/api/jobs", {
    method: "POST",
    headers: jsonHeaders,
    cache: "no-store",
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    if (response.status === 422) {
      throw new Error("Missing required fields: team name");
    }
    await handleError(response);
  }

  const responsePayload = (await response.json()) as unknown;
  const normalized =
    responsePayload &&
    typeof responsePayload === "object" &&
    "data" in responsePayload
      ? (responsePayload as { data?: unknown }).data
      : responsePayload;
  const normalizedRecord = (normalized ?? {}) as {
    id?: string;
    job_id?: string;
    jobId?: string;
    status?: JobStatus;
  };
  const jobId = normalizedRecord.job_id ?? normalizedRecord.jobId ?? normalizedRecord.id;
  const status = normalizedRecord.status;
  return { jobId, status };
}

export async function enqueueJob(jobId: string) {
  const response = await fetchWithTimeout(`/api/jobs/${jobId}/enqueue`, {
    method: "POST",
    headers: jsonHeaders,
    cache: "no-store",
    body: toJsonBody()
  });

  if (!response.ok) {
    await handleError(response);
  }

  const payload = unwrap<UnknownRecord>(await response.json());
  return normalizeJob(payload);
}

export async function getJob(jobId: string, trackId?: string | null) {
  const searchParams = new URLSearchParams();
  if (trackId) {
    searchParams.set("track_id", trackId);
  }
  const query = searchParams.toString();
  const response = await fetchWithTimeout(
    `/api/jobs/${jobId}${query ? `?${query}` : ""}`,
    {
      method: "GET",
      cache: "no-store"
    }
  );

  if (!response.ok) {
    await handleError(response);
  }

  const payload = unwrap<UnknownRecord>(await response.json());
  const mapped = normalizeJob(payload);
  console.log("Mapped job response", mapped);
  return mapped;
}

export async function getJobOverlayFrames(jobId: string): Promise<OverlayFramesResponse> {
  const response = await fetchWithTimeout(
    `/api/jobs/${encodeURIComponent(jobId)}/frames/overlay?ts=${Date.now()}`,
    {
      method: "GET",
      cache: "no-store"
    }
  );

  if (!response.ok) {
    await handleError(response);
  }

  const payload = unwrap<UnknownRecord | UnknownRecord[] | null>(
    await response.json().catch(() => null)
  );
  const overlayReadyRaw =
    payload && !Array.isArray(payload)
      ? ((payload as UnknownRecord).overlay_ready ??
          (payload as UnknownRecord).overlayReady ??
          null)
      : null;
  const framesSource = Array.isArray(payload)
    ? payload
    : payload?.frames ?? payload?.items ?? payload?.preview_frames ?? [];
  return {
    frames: normalizePreviewFrames(framesSource),
    overlayReady: typeof overlayReadyRaw === "boolean" ? overlayReadyRaw : null
  };
}

export async function getJobStatus(jobId: string) {
  return getJob(jobId);
}

export async function getJobFrames(jobId: string, count = 8) {
  const response = await fetchWithTimeout(
    `/api/jobs/${jobId}/frames?count=${count}`,
    {
      method: "GET",
      cache: "no-store"
    }
  );

  if (!response.ok) {
    await handleError(response);
  }

  const payload = unwrap<UnknownRecord | null>(
    await response.json().catch(() => null)
  );
  const framesSource = payload?.frames ?? payload?.items ?? [];
  const frames = Array.isArray(framesSource)
    ? framesSource.map((frame) => {
        const mapped = mapFrameListItem(frame as UnknownRecord);
        return {
          t: mapped.time_sec ?? 0,
          url: mapped.url,
          w: mapped.width ?? 0,
          h: mapped.height ?? 0
        };
      })
    : [];

  return { frames };
}

export async function listJobFrames(jobId: string, count = 8) {
  const response = await fetchWithTimeout(
    `/api/jobs/${encodeURIComponent(jobId)}/frames?count=${count}`,
    {
      method: "GET",
      cache: "no-store"
    }
  );

  if (!response.ok) {
    await handleError(response);
  }

  const payload = unwrap<UnknownRecord | UnknownRecord[] | null>(
    await response.json().catch(() => null)
  );
  const itemsSource = Array.isArray(payload)
    ? payload
    : payload?.frames ?? payload?.items ?? [];

  return {
    ok: true,
    items: normalizeFrameListItems(itemsSource)
  };
}

export async function getJobFramesList(jobId: string) {
  return listJobFrames(jobId);
}

export async function saveJobPlayerRef(jobId: string, payload: FrameSelection) {
  const frameTimeSec = payload.frameTimeSec ?? payload.frame_time_sec ?? payload.t ?? null;
  if (frameTimeSec === null || frameTimeSec === undefined) {
    throw new Error("Missing frame time from preview frame. Check /frames mapping.");
  }
  const requestPayload = {
    frame_time_sec: frameTimeSec,
    bbox_xywh: {
      x: payload.x,
      y: payload.y,
      w: payload.w,
      h: payload.h
    }
  };
  const response = await fetchWithTimeout(`/api/jobs/${jobId}/player-ref`, {
    method: "POST",
    headers: jsonHeaders,
    cache: "no-store",
    body: JSON.stringify(requestPayload)
  });

  if (!response.ok) {
    await handleError(response);
  }

  const responsePayload = unwrap<UnknownRecord | null>(
    await response.json().catch(() => null)
  );
  return responsePayload;
}

export async function saveJobTargetSelection(
  jobId: string,
  payload: { selections: TargetSelection[]; force?: boolean }
) {
  const selections = payload.selections.map((selection) => {
    const frameTimeSec =
      selection.frameTimeSec ?? selection.frame_time_sec ?? selection.t ?? null;
    const frameKey = selection.frameKey ?? selection.frame_key ?? null;
    const trackId = selection.trackId ?? selection.track_id ?? null;
    if (
      !frameKey ||
      !trackId ||
      frameTimeSec === null ||
      frameTimeSec === undefined
    ) {
      const error = new Error(
        "Target selection payload missing frame_key, track_id, or time."
      );
      (error as Error & { code?: string }).code = "INVALID_PAYLOAD";
      throw error;
    }
    const bbox = {
      x: selection.x,
      y: selection.y,
      w: selection.w,
      h: selection.h
    };
    return {
      frame_key: frameKey,
      track_id: trackId,
      time_sec: frameTimeSec,
      frame_time_sec: frameTimeSec,
      bbox,
      x: selection.x,
      y: selection.y,
      w: selection.w,
      h: selection.h
    };
  });
  const requestPayload = {
    selections,
    ...(payload.force ? { force: true } : {})
  };
  console.info("[target] payload", requestPayload);
  const response = await fetchWithTimeout(`/api/jobs/${jobId}/target`, {
    method: "POST",
    headers: jsonHeaders,
    cache: "no-store",
    body: JSON.stringify(requestPayload)
  });

  if (!response.ok) {
    await handleError(response);
  }

  const responsePayload = unwrap<UnknownRecord | null>(
    await response.json().catch(() => null)
  );
  return responsePayload;
}

export async function pickJobPlayer(
  jobId: string,
  payload: { frameKey: string; trackId: string }
) {
  const requestPayload = {
    frame_key: payload.frameKey,
    track_id: payload.trackId
  };
  const response = await fetchWithTimeout(`/api/jobs/${jobId}/pick-player`, {
    method: "POST",
    headers: jsonHeaders,
    cache: "no-store",
    body: JSON.stringify(requestPayload)
  });

  if (!response.ok) {
    await handleError(response);
  }

  const responsePayload = unwrap<UnknownRecord | null>(
    await response.json().catch(() => null)
  );
  return responsePayload;
}

export async function analyzeJobPlayer(
  jobId: string,
  payload: { frameKey: string; trackId: string }
) {
  const requestPayload = {
    frame_key: payload.frameKey,
    track_id: payload.trackId
  };
  const response = await fetchWithTimeout(`/api/jobs/${jobId}/analyze-player`, {
    method: "POST",
    headers: jsonHeaders,
    cache: "no-store",
    body: JSON.stringify(requestPayload)
  });

  if (!response.ok) {
    await handleError(response);
  }

  const responsePayload = unwrap<UnknownRecord | null>(
    await response.json().catch(() => null)
  );
  return responsePayload;
}

export async function getJobTrackCandidates(
  jobId: string
): Promise<TrackCandidatesResponse> {
  const response = await fetchWithTimeout(`/api/jobs/${jobId}/candidates`, {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    await handleError(response);
  }

  const payload = unwrap<UnknownRecord | UnknownRecord[] | null>(
    await response.json().catch(() => null)
  );
  return normalizeTrackCandidates(payload);
}

export async function selectJobTrack(jobId: string, candidate: TrackCandidate) {
  const frameTimeSec = candidate.frameTimeSec ?? candidate.frame_time_sec ?? candidate.t ?? null;
  const { x, y, w, h } = candidate;
  if (
    frameTimeSec === null ||
    frameTimeSec === undefined ||
    x === null ||
    x === undefined ||
    y === null ||
    y === undefined ||
    w === null ||
    w === undefined ||
    h === null ||
    h === undefined
  ) {
    throw new Error("Missing selection data for track candidate.");
  }
  const requestPayload = {
    trackId: candidate.trackId,
    selection: {
      time_sec: frameTimeSec,
      frame_time_sec: frameTimeSec,
      bbox: {
        x,
        y,
        w,
        h
      }
    }
  };
  const response = await fetchWithTimeout(`/api/jobs/${jobId}/select-track`, {
    method: "POST",
    headers: jsonHeaders,
    cache: "no-store",
    body: JSON.stringify(requestPayload)
  });

  if (!response.ok) {
    await handleError(response);
  }

  const payload = unwrap<UnknownRecord | null>(await response.json().catch(() => null));
  return payload;
}
