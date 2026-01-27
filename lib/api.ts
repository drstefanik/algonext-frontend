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
  signedUrl: string;
  width?: number | null;
  height?: number | null;
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
  x: number;
  y: number;
  w: number;
  h: number;
};

export type JobTarget = {
  selections?: TargetSelection[];
  [key: string]: any;
};

export type TrackCandidate = {
  trackId: string;
  coverage?: number | null;
  stability?: number | null;
  avgBoxArea?: number | null;
  thumbnailUrl?: string | null;
  tier?: string | null;
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

const unwrap = <T,>(payload: unknown): T => {
  if (payload && typeof payload === "object" && "ok" in payload && "data" in payload) {
    return (payload as { data?: T }).data as T;
  }
  return payload as T;
};

const mapPreviewFrame = (frame: UnknownRecord): PreviewFrame => {
  const timeSec = coerceNumber(frame.timeSec ?? frame.time_sec ?? frame.t);
  const key = frame.key ?? `frame-${timeSec}`;
  const url = frame.url ?? frame.signedUrl ?? frame.signed_url ?? "";
  const signedUrl = frame.signedUrl ?? frame.signed_url ?? frame.url ?? "";
  const width = frame.width ?? frame.w ?? null;
  const height = frame.height ?? frame.h ?? null;

  return {
    ...frame,
    timeSec,
    key,
    url,
    signedUrl,
    width,
    height
  };
};

const mapFrameListItem = (frame: UnknownRecord): FrameItem => {
  const timeSec = coerceNumber(frame.timeSec ?? frame.time_sec ?? frame.t);
  const key = frame.key ?? frame.frame_key ?? frame.s3_key ?? `frame-${timeSec ?? 0}`;
  const url = frame.url ?? frame.signedUrl ?? frame.signed_url ?? "";
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

  return frames.map(mapPreviewFrame).filter((frame) => Boolean(frame.signedUrl));
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
  return {
    frameTimeSec,
    x: selection.x ?? 0,
    y: selection.y ?? 0,
    w: selection.w ?? 0,
    h: selection.h ?? 0
  };
};

const mapTrackCandidate = (candidate: UnknownRecord): TrackCandidate => {
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
    null;
  const tier =
    candidate.tier ??
    candidate.group ??
    candidate.section ??
    candidate.category ??
    candidate.bucket ??
    candidate.segment ??
    null;

  return {
    trackId,
    coverage,
    stability,
    avgBoxArea,
    thumbnailUrl,
    tier
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
  const rawPlayerRef = data.player_ref ?? data.playerRef ?? null;
  const playerRef = normalizePlayerRef(rawPlayerRef);
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
  const mapped: UnknownRecord = {
    ...data,
    createdAt: data.createdAt ?? data.created_at ?? null,
    updatedAt: data.updatedAt ?? data.updated_at ?? null,
    playerRef,
    target,
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

  try {
    const data = await response.clone().json();
    const detailMessage = extractDetailMessage(data?.detail);
    message =
      detailMessage ??
      (typeof data?.error === "string" ? data.error : data?.error?.message) ??
      data?.progress?.message ??
      data?.message ??
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

  throw new Error(message);
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
    cache: "no-store"
  });

  if (!response.ok) {
    await handleError(response);
  }

  const payload = unwrap<UnknownRecord>(await response.json());
  return normalizeJob(payload);
}

export async function getJob(jobId: string) {
  const response = await fetchWithTimeout(`/api/jobs/${jobId}`, {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    await handleError(response);
  }

  const payload = unwrap<UnknownRecord>(await response.json());
  const mapped = normalizeJob(payload);
  console.log("Mapped job response", mapped);
  return mapped;
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

  return (await response.json()) as { frames: JobFrame[] };
}

export async function listJobFrames(jobId: string) {
  const response = await fetchWithTimeout(
    `/api/jobs/${encodeURIComponent(jobId)}/frames/list?ts=${Date.now()}`,
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
    : payload?.items ?? payload?.frames ?? [];

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
    throw new Error("Missing frame time from preview frame. Check /frames/list mapping.");
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
  payload: { selections: TargetSelection[] }
) {
  const selections = payload.selections.map((selection) => {
    const frameTimeSec = selection.frameTimeSec ?? selection.frame_time_sec ?? null;
    return {
      frame_time_sec: frameTimeSec,
      x: selection.x,
      y: selection.y,
      w: selection.w,
      h: selection.h
    };
  });
  const requestPayload = { selections };
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

export async function selectJobTrack(jobId: string, trackId: string) {
  const response = await fetchWithTimeout(`/api/jobs/${jobId}/select-track`, {
    method: "POST",
    headers: jsonHeaders,
    cache: "no-store",
    body: JSON.stringify({ track_id: trackId, trackId })
  });

  if (!response.ok) {
    await handleError(response);
  }

  const payload = unwrap<UnknownRecord | null>(await response.json().catch(() => null));
  return payload;
}
