export type CreateJobPayload = {
  video_url: string;
  role: string;
  category: string;
  shirt_number: number;
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
};

export type JobResultSummary = {
  player_role?: string;
  overall_score?: number;
};

export type JobAssetVideo = {
  s3_key?: string;
  signed_url?: string;
  expires_in?: number;
};

export type JobClip = {
  index?: number;
  start?: number;
  end?: number;
  s3_key?: string;
  signed_url?: string;
  expires_in?: number;
};

export type PreviewFrame = {
  time_sec: number;
  key: string;
  signed_url: string;
  width?: number | null;
  height?: number | null;
};

export type JobResult = {
  schema_version?: string;
  summary?: JobResultSummary;
  radar?: Record<string, number>;
  assets?: {
    input_video?: JobAssetVideo;
  };
  clips?: JobClip[];
  preview_frames?: PreviewFrame[];
  [key: string]: any;
};

export type JobResponse = {
  job_id?: string;
  status?: JobStatus;
  progress?: JobProgress;
  result?: JobResult;
  player_ref?: FrameSelection;
  error?: string;
  created_at?: string;
  updated_at?: string;
};

export type JobFrame = {
  t: number;
  url: string;
  w: number;
  h: number;
};

export type FrameSelection = {
  t: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

const jsonHeaders = {
  "Content-Type": "application/json"
};

async function handleError(response: Response) {
  let message = response.statusText || "Request failed";

  try {
    const data = await response.clone().json();
    if (data?.message) {
      message = data.message;
    } else if (data?.error) {
      message = data.error;
    } else {
      message = JSON.stringify(data);
    }
  } catch {
    try {
      const text = await response.text();
      if (text) {
        message = text;
      }
    } catch {
      // ignore parsing errors
    }
  }

  throw new Error(message);
}

export async function createJob(payload: CreateJobPayload) {
  const response = await fetch("/api/jobs", {
    method: "POST",
    headers: jsonHeaders,
    cache: "no-store",
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    await handleError(response);
  }

  return (await response.json()) as { job_id: string; status: JobStatus };
}

export async function enqueueJob(jobId: string) {
  const response = await fetch(`/api/jobs/${jobId}/enqueue`, {
    method: "POST",
    headers: jsonHeaders,
    cache: "no-store"
  });

  if (!response.ok) {
    await handleError(response);
  }

  return (await response.json()) as JobResponse;
}

export async function getJob(jobId: string) {
  const response = await fetch(`/api/jobs/${jobId}`, {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    await handleError(response);
  }

  return (await response.json()) as JobResponse;
}

export async function getJobStatus(jobId: string) {
  return getJob(jobId);
}

export async function getJobFrames(jobId: string, count = 8) {
  const response = await fetch(`/api/jobs/${jobId}/frames?count=${count}`, {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    await handleError(response);
  }

  return (await response.json()) as { frames: JobFrame[] };
}

export async function saveJobSelection(
  jobId: string,
  payload: {
    selections: FrameSelection[];
    player: {
      shirt_number: number;
      team_name: string;
      player_name?: string;
    };
  }
) {
  const response = await fetch(`/api/jobs/${jobId}/selection`, {
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

export async function saveJobPlayerRef(jobId: string, payload: FrameSelection) {
  const response = await fetch(`/api/jobs/${jobId}/player-ref`, {
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
