export type CreateJobPayload = {
  video_url: string;
  role: string;
  category: string;
  shirt_number: number;
};

export type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | string;

export type JobProgress = {
  pct?: number;
  step?: string;
  message?: string;
};

export type JobResult = {
  summary?: {
    overall_score?: number;
    player_role?: string;
    radar?: Record<string, number>;
  };
  assets?: {
    input_video?: { signed_url?: string };
    clips?: Array<{
      start?: number;
      end?: number;
      signed_url?: string;
    }>;
  };
};

export type JobResponse = {
  job_id?: string;
  status?: JobStatus;
  progress?: JobProgress;
  result?: JobResult;
  error?: string;
  created_at?: string;
  updated_at?: string;
};

const API = process.env.NEXT_PUBLIC_API_BASE_URL;

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

function ensureApiBase(): string {
  if (!API) {
    throw new Error("Missing NEXT_PUBLIC_API_BASE_URL");
  }
  return API;
}

export async function createJob(payload: CreateJobPayload) {
  const apiBase = ensureApiBase();
  const response = await fetch(`${apiBase}/jobs`, {
    method: "POST",
    headers: jsonHeaders,
    mode: "cors",
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    await handleError(response);
  }

  return (await response.json()) as { job_id: string; status: JobStatus };
}

export async function enqueueJob(jobId: string) {
  const apiBase = ensureApiBase();
  const response = await fetch(`${apiBase}/jobs/${jobId}/enqueue`, {
    method: "POST",
    headers: jsonHeaders,
    mode: "cors"
  });

  if (!response.ok) {
    await handleError(response);
  }

  return (await response.json()) as JobResponse;
}

export async function getJob(jobId: string) {
  const apiBase = ensureApiBase();
  const response = await fetch(`${apiBase}/jobs/${jobId}`, {
    method: "GET",
    mode: "cors"
  });

  if (!response.ok) {
    await handleError(response);
  }

  return (await response.json()) as JobResponse;
}

export async function getJobStatus(jobId: string) {
  return getJob(jobId);
}
