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
  shirt_number: number;
  team_name: string;
};

export type JobStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "WAITING_FOR_SELECTION"
  | "WAITING_FOR_PLAYER"
  | string;

export type JobProgress = {
  pct?: number;
  step?: string;
  message?: string;
  updatedAt?: string;
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
  timeSec: number;
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
  };
  clips?: JobClip[];
  previewFrames?: PreviewFrame[];
  [key: string]: any;
};

export type JobResponse = {
  jobId?: string;
  status?: JobStatus;
  progress?: JobProgress;
  previewFrames?: PreviewFrame[];
  result?: JobResult;
  playerRef?: FrameSelection;
  target?: JobTarget;
  error?: string;
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
  t: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type TargetSelection = {
  frameTimeSec: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type JobTarget = {
  selections?: TargetSelection[];
  [key: string]: any;
};

type UnknownRecord = Record<string, any>;

const jsonHeaders = {
  "Content-Type": "application/json"
};

const DEFAULT_TIMEOUT_MS = 15000;

const mapPreviewFrame = (frame: UnknownRecord): PreviewFrame => {
  const timeSec = frame.timeSec ?? frame.time_sec ?? frame.t ?? 0;
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
  const timeSec = frame.timeSec ?? frame.time_sec ?? frame.t ?? null;
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
  return mapJobResponse(normalized ?? {});
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

  const payload = (await response.json()) as UnknownRecord;
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

  const payload = (await response.json()) as UnknownRecord;
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

  const payload = await response.json().catch(() => null);
  const itemsSource = Array.isArray(payload)
    ? payload
    : payload?.items ??
      payload?.frames ??
      payload?.data?.items ??
      payload?.data?.frames ??
      payload?.data?.data?.items ??
      payload?.data?.data?.frames ??
      [];

  return {
    ok: true,
    items: normalizeFrameListItems(itemsSource)
  };
}

export async function getJobFramesList(jobId: string) {
  return listJobFrames(jobId);
}

export async function saveJobPlayerRef(jobId: string, payload: FrameSelection) {
  const response = await fetchWithTimeout(`/api/jobs/${jobId}/player-ref`, {
    method: "POST",
    headers: jsonHeaders,
    cache: "no-store",
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    await handleError(response);
  }

  return response;
}

export async function saveJobTargetSelection(
  jobId: string,
  payload: { selections: TargetSelection[] }
) {
  const requestPayload = {
    selections: payload.selections.map((selection) => ({
      frame_time_sec: selection.frameTimeSec,
      x: selection.x,
      y: selection.y,
      w: selection.w,
      h: selection.h
    }))
  };
  const response = await fetchWithTimeout(`/api/jobs/${jobId}/target`, {
    method: "POST",
    headers: jsonHeaders,
    cache: "no-store",
    body: JSON.stringify(requestPayload)
  });

  if (!response.ok) {
    await handleError(response);
  }

  return response;
}
