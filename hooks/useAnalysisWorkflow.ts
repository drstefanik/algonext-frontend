"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  confirmTarget,
  createJob,
  enqueueJob,
  getFrames,
  getJob,
  isFramesNotReadyError,
  pickPlayer,
  type AnalysisJob,
  type CreateJobInput,
  type PreviewFrame,
  type PreviewTrack,
  WorkflowApiError
} from "@/lib/workflow-api";
import { retryJob } from "@/lib/retry-job";

const STORAGE_KEY = "algonext.current-job.v2";
const TERMINAL_STATUSES = new Set(["COMPLETED", "PARTIAL", "FAILED"]);
const ACTIVE_ANALYSIS_STATUSES = new Set(["QUEUED", "RUNNING", "PROCESSING"]);

export type PlayerSelection = {
  frame: PreviewFrame;
  track: PreviewTrack;
};

export type WorkflowStage =
  | "create"
  | "preparing"
  | "select-player"
  | "ready"
  | "analysis"
  | "result"
  | "failed";

const mergeFrames = (primary: PreviewFrame[], fallback: PreviewFrame[]) => {
  const byKey = new Map<string, PreviewFrame>();
  for (const frame of fallback) byKey.set(frame.key, frame);
  for (const frame of primary) {
    const previous = byKey.get(frame.key);
    byKey.set(frame.key, {
      ...previous,
      ...frame,
      tracks: frame.tracks.length > 0 ? frame.tracks : previous?.tracks ?? []
    });
  }
  return [...byKey.values()].sort(
    (left, right) =>
      (left.timeSec ?? Number.MAX_SAFE_INTEGER) -
      (right.timeSec ?? Number.MAX_SAFE_INTEGER)
  );
};

const getPollingDelay = (job: AnalysisJob | null) => {
  if (!job) return 2_500;
  if (ACTIVE_ANALYSIS_STATUSES.has(job.status)) return 2_000;
  if (job.status === "READY_TO_ENQUEUE") return 10_000;
  return 3_500;
};

export const getWorkflowStage = (
  job: AnalysisJob | null,
  frames: PreviewFrame[]
): WorkflowStage => {
  if (!job) return "create";
  if (job.status === "FAILED") return "failed";
  if (job.status === "COMPLETED" || job.status === "PARTIAL") return "result";
  if (ACTIVE_ANALYSIS_STATUSES.has(job.status)) return "analysis";
  if (job.status === "READY_TO_ENQUEUE" || (job.playerSaved && job.targetSaved)) {
    return "ready";
  }
  if (frames.some((frame) => frame.tracks.length > 0)) return "select-player";
  return "preparing";
};

const ERROR_MESSAGES: Record<string, string> = {
  WORKER_NOT_READY:
    "Il worker di analisi non è ancora pronto o non esegue la stessa versione del backend. Attendi il completamento del deploy e riprova.",
  RETRY_LIMIT_REACHED:
    "Questo job ha raggiunto il numero massimo di tentativi automatici.",
  RETRY_NOT_READY:
    "Il job non conserva una selezione completa del giocatore e non può essere riavviato in sicurezza.",
  RETRY_ENQUEUE_FAILED:
    "Il worker è disponibile, ma il nuovo tentativo non è entrato nella coda."
};

const formatError = (error: unknown) => {
  if (error instanceof WorkflowApiError) {
    const requestSuffix = error.requestId ? ` · request ${error.requestId}` : "";
    return `${ERROR_MESSAGES[error.code] ?? error.message}${requestSuffix}`;
  }
  return error instanceof Error ? error.message : "Errore inatteso.";
};

export function useAnalysisWorkflow() {
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [frames, setFrames] = useState<PreviewFrame[]>([]);
  const [selection, setSelection] = useState<PlayerSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const pollGeneration = useRef(0);
  const bootstrapped = useRef(false);

  const persistJobId = useCallback((nextJobId: string | null) => {
    if (typeof window === "undefined") return;
    if (nextJobId) window.localStorage.setItem(STORAGE_KEY, nextJobId);
    else window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  const loadFrames = useCallback(async (id: string, currentFrames: PreviewFrame[]) => {
    try {
      const fetched = await getFrames(id, 32);
      return mergeFrames(currentFrames, fetched);
    } catch (frameError) {
      if (isFramesNotReadyError(frameError)) return currentFrames;
      throw frameError;
    }
  }, []);

  const refresh = useCallback(
    async (id = jobId, options?: { silent?: boolean }) => {
      if (!id) return null;
      if (!options?.silent) setBusyAction("refresh");
      try {
        const nextJob = await getJob(id);
        setJob(nextJob);
        setJobId(nextJob.id);
        persistJobId(nextJob.id);
        setFrames((existing) => mergeFrames(nextJob.previewFrames, existing));
        setError(null);

        if (nextJob.previewFrames.length === 0 && !TERMINAL_STATUSES.has(nextJob.status)) {
          const fallback = await loadFrames(nextJob.id, []);
          if (fallback.length > 0) {
            setFrames((existing) => mergeFrames(existing, fallback));
          }
        }
        return nextJob;
      } catch (refreshError) {
        setError(formatError(refreshError));
        throw refreshError;
      } finally {
        if (!options?.silent) setBusyAction(null);
      }
    },
    [jobId, loadFrames, persistJobId]
  );

  const resume = useCallback(
    async (id: string) => {
      const normalized = id.trim();
      if (!normalized) return;
      setBusyAction("resume");
      setError(null);
      setJobId(normalized);
      persistJobId(normalized);
      try {
        await refresh(normalized, { silent: true });
      } catch {
        setJobId(null);
        persistJobId(null);
      } finally {
        setBusyAction(null);
        setIsBootstrapping(false);
      }
    },
    [persistJobId, refresh]
  );

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setIsBootstrapping(false);
      return;
    }
    void resume(stored);
  }, [resume]);

  useEffect(() => {
    if (!jobId || !job || TERMINAL_STATUSES.has(job.status)) return;
    const generation = ++pollGeneration.current;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const poll = async () => {
      try {
        const nextJob = await refresh(jobId, { silent: true });
        if (stopped || generation !== pollGeneration.current || !nextJob) return;
        if (!TERMINAL_STATUSES.has(nextJob.status)) {
          timeout = setTimeout(poll, getPollingDelay(nextJob));
        }
      } catch {
        if (!stopped && generation === pollGeneration.current) {
          timeout = setTimeout(poll, 8_000);
        }
      }
    };

    timeout = setTimeout(poll, getPollingDelay(job));
    return () => {
      stopped = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [job, jobId, refresh]);

  const start = useCallback(
    async (input: CreateJobInput) => {
      setBusyAction("create");
      setError(null);
      setSelection(null);
      setFrames([]);
      try {
        const created = await createJob(input);
        setJob(created);
        setJobId(created.id);
        setFrames(created.previewFrames);
        persistJobId(created.id);
      } catch (createError) {
        setError(formatError(createError));
      } finally {
        setBusyAction(null);
      }
    },
    [persistJobId]
  );

  const choosePlayer = useCallback(
    async (nextSelection: PlayerSelection) => {
      if (!jobId) return;
      setBusyAction("select-player");
      setSelection(nextSelection);
      setError(null);
      try {
        await pickPlayer(jobId, nextSelection.frame.key, nextSelection.track.trackId);
        await confirmTarget(jobId, nextSelection);
        await refresh(jobId, { silent: true });
      } catch (selectionError) {
        setError(formatError(selectionError));
      } finally {
        setBusyAction(null);
      }
    },
    [jobId, refresh]
  );

  const enqueue = useCallback(async () => {
    if (!jobId) return;
    setBusyAction("enqueue");
    setError(null);
    try {
      await enqueueJob(jobId);
      await refresh(jobId, { silent: true });
    } catch (enqueueError) {
      setError(formatError(enqueueError));
    } finally {
      setBusyAction(null);
    }
  }, [jobId, refresh]);

  const retry = useCallback(async () => {
    if (!jobId) return;
    setBusyAction("retry");
    setError(null);
    pollGeneration.current += 1;
    try {
      await retryJob(jobId);
      await refresh(jobId, { silent: true });
    } catch (retryError) {
      setError(formatError(retryError));
    } finally {
      setBusyAction(null);
    }
  }, [jobId, refresh]);

  const reset = useCallback(() => {
    pollGeneration.current += 1;
    setJob(null);
    setJobId(null);
    setFrames([]);
    setSelection(null);
    setError(null);
    setBusyAction(null);
    persistJobId(null);
  }, [persistJobId]);

  const stage = useMemo(() => getWorkflowStage(job, frames), [frames, job]);
  const isBusy = busyAction !== null;

  return {
    job,
    jobId,
    frames,
    selection,
    stage,
    error,
    busyAction,
    isBusy,
    isBootstrapping,
    start,
    resume,
    refresh,
    choosePlayer,
    enqueue,
    retry,
    reset,
    setSelection
  };
}
