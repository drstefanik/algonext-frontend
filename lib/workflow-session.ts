import type { AnalysisJob, PreviewFrame } from "./workflow-api";

export const STORAGE_KEY = "algonext.current-job.v2";

export const readStoredJobId = (): string | null => {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be disabled by the browser; the current tab still works.
    return null;
  }
};

export const storeJobId = (id: string | null): void => {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Persistence is optional and must not turn a successful API call into a failure.
  }
};

export const mergeJobFrames = (
  jobId: string,
  primary: PreviewFrame[],
  fallback: PreviewFrame[]
): PreviewFrame[] => {
  const prefix = `jobs/${jobId}/frames/`;
  const byKey = new Map<string, PreviewFrame>();
  for (const frame of fallback) {
    if (frame.key.startsWith(prefix)) byKey.set(frame.key, frame);
  }
  for (const frame of primary) {
    if (frame.key.startsWith(prefix)) byKey.set(frame.key, frame);
  }
  return [...byKey.values()].sort(
    (left, right) => (left.timeSec ?? Infinity) - (right.timeSec ?? Infinity)
  );
};

export const canRetryPreparation = (job: AnalysisJob): boolean =>
  job.status === "FAILED" &&
  !job.playerSaved &&
  !job.targetSaved &&
  ["preview_generation_failed", "candidates_generation_failed", "PREPARATION_ENQUEUE_FAILED"]
    .includes(job.failureReason ?? "");
