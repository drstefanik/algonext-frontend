export type CreateJobPayload = {
  video_url: string;
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
  signedUrl: string;
  width?: number | null;
  height?: number | null;
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
    if (response.status === 422) {
      throw new Error("Missing required fields: team name");
    }
    await handleError(response);
  }

  const data = (await response.json()) as { job_id: string; status: JobStatus };
  return { jobId: data.job_id, status: data.status };
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

export async function listJobFrames(jobId: string) {
  const response = await fetch(`/api/jobs/${jobId}/frames/list`, {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    await handleError(response);
  }

  return (await response.json()) as JobFrameListResponse;
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
  const response = await fetch(`/api/jobs/${jobId}/target`, {
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

export async function confirmJobSelection(jobId: string) {
  const response = await fetch(`/api/jobs/${jobId}/confirm-selection`, {
    method: "POST",
    headers: jsonHeaders,
    cache: "no-store"
  });

  if (!response.ok) {
    await handleError(response);
  }

  return response;
}
