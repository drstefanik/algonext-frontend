"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  confirmSelections,
  createJob,
  enqueueJob,
  getFrames,
  getJob,
  getTargetAnalysisAttemptId,
  isFramesNotReadyError,
  pickPlayer,
  type AnalysisJob,
  type CreateJobInput,
  type PreviewFrame,
  WorkflowApiError
} from "@/lib/workflow-api";
import {
  savePlayerProfile,
  type PlayerProfileInput
} from "@/lib/player-profile-api";
import {
  MAX_PLAYER_SELECTIONS,
  togglePlayerSelection,
  type PlayerSelection
} from "@/lib/player-selections";
import { transitionReselectionRecovery } from "@/lib/reselection-recovery";
import { mayCommitRefresh } from "@/lib/refresh-commit-guard";
import { retryJob } from "@/lib/retry-job";

const STORAGE_KEY = "algonext.current-job.v2";
const TERMINAL_STATUSES = new Set(["COMPLETED", "PARTIAL", "FAILED"]);
const ACTIVE_ANALYSIS_STATUSES = new Set(["QUEUED", "RUNNING", "PROCESSING"]);
export type { PlayerSelection } from "@/lib/player-selections";

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
    "Il worker è disponibile, ma il nuovo tentativo non è entrato nella coda.",
  ANALYSIS_ATTEMPT_PRECONDITION_REQUIRED:
    "Il job è avanzato. Ricarica lo stato corrente prima di riprovare.",
  ANALYSIS_ATTEMPT_MISMATCH:
    "Il job è già avanzato a un altro tentativo. Lo stato è stato ricaricato in sicurezza."
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
  const [selections, setSelections] = useState<PlayerSelection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const workflowEpoch = useRef(0);
  const refreshSequence = useRef(0);
  const [epochVersion, setEpochVersion] = useState(0);
  const bootstrapped = useRef(false);
  const reselectionClearedJobId = useRef<string | null>(null);
  const selection = selections[0] ?? null;

  const beginTransition = useCallback(() => {
    workflowEpoch.current += 1;
    refreshSequence.current += 1;
    setEpochVersion(workflowEpoch.current);
    return workflowEpoch.current;
  }, []);

  const isCurrentEpoch = useCallback(
    (expectedEpoch: number) => expectedEpoch === workflowEpoch.current,
    []
  );

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
    async (
      id = jobId,
      options?: { silent?: boolean; expectedEpoch?: number }
    ) => {
      if (!id) return null;
      const token = {
        epoch: options?.expectedEpoch ?? workflowEpoch.current,
        sequence: ++refreshSequence.current
      };
      const canCommit = () =>
        mayCommitRefresh(
          token,
          workflowEpoch.current,
          refreshSequence.current
        );
      if (!canCommit()) return null;
      if (!options?.silent) setBusyAction("refresh");
      try {
        const nextJob = await getJob(id);
        if (!canCommit()) return null;
        setJob(nextJob);
        setJobId(nextJob.id);
        persistJobId(nextJob.id);
        setFrames((existing) => mergeFrames(nextJob.previewFrames, existing));
        const recovery = transitionReselectionRecovery(
          reselectionClearedJobId.current,
          nextJob
        );
        reselectionClearedJobId.current = recovery.clearedJobId;
        if (recovery.clearSelections) {
          setSelections([]);
        }
        setError(null);

        if (nextJob.previewFrames.length === 0 && !TERMINAL_STATUSES.has(nextJob.status)) {
          const fallback = await loadFrames(nextJob.id, []);
          if (!canCommit()) return null;
          if (fallback.length > 0) {
            setFrames((existing) => mergeFrames(existing, fallback));
          }
        }
        return canCommit() ? nextJob : null;
      } catch (refreshError) {
        if (!canCommit()) return null;
        setError(formatError(refreshError));
        throw refreshError;
      } finally {
        if (!options?.silent && canCommit()) setBusyAction(null);
      }
    },
    [jobId, loadFrames, persistJobId]
  );

  const reconcileMutationError = useCallback(
    async (mutationError: unknown, id: string, expectedEpoch: number) => {
      if (!isCurrentEpoch(expectedEpoch)) return;
      if (
        mutationError instanceof WorkflowApiError &&
        (mutationError.code === "ANALYSIS_ATTEMPT_MISMATCH" ||
          mutationError.code ===
            "ANALYSIS_ATTEMPT_PRECONDITION_REQUIRED")
      ) {
        try {
          await refresh(id, { silent: true, expectedEpoch });
        } catch {
          // The guarded refresh already exposes its own transport error.
        }
      }
      if (isCurrentEpoch(expectedEpoch)) {
        setError(formatError(mutationError));
      }
    },
    [isCurrentEpoch, refresh]
  );

  const resume = useCallback(
    async (id: string) => {
      const normalized = id.trim();
      if (!normalized) return;
      const epoch = beginTransition();
      setBusyAction("resume");
      setError(null);
      setJobId(normalized);
      persistJobId(normalized);
      try {
        await refresh(normalized, { silent: true, expectedEpoch: epoch });
      } catch {
        if (isCurrentEpoch(epoch)) {
          setJobId(null);
          persistJobId(null);
        }
      } finally {
        if (isCurrentEpoch(epoch)) {
          setBusyAction(null);
          setIsBootstrapping(false);
        }
      }
    },
    [beginTransition, isCurrentEpoch, persistJobId, refresh]
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
    if (
      busyAction ||
      !jobId ||
      !job ||
      TERMINAL_STATUSES.has(job.status)
    ) {
      return;
    }
    const generation = workflowEpoch.current;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const poll = async () => {
      try {
        const nextJob = await refresh(jobId, {
          silent: true,
          expectedEpoch: generation
        });
        if (stopped || !isCurrentEpoch(generation) || !nextJob) return;
        if (!TERMINAL_STATUSES.has(nextJob.status)) {
          timeout = setTimeout(poll, getPollingDelay(nextJob));
        }
      } catch {
        if (!stopped && isCurrentEpoch(generation)) {
          timeout = setTimeout(poll, 8_000);
        }
      }
    };

    timeout = setTimeout(poll, getPollingDelay(job));
    return () => {
      stopped = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [busyAction, epochVersion, isCurrentEpoch, job, jobId, refresh]);

  const start = useCallback(
    async (input: CreateJobInput) => {
      const epoch = beginTransition();
      setBusyAction("create");
      setError(null);
      reselectionClearedJobId.current = null;
      setSelections([]);
      setFrames([]);
      try {
        const created = await createJob(input);
        if (!isCurrentEpoch(epoch)) return;
        setJob(created);
        setJobId(created.id);
        setFrames(created.previewFrames);
        persistJobId(created.id);
      } catch (createError) {
        if (isCurrentEpoch(epoch)) setError(formatError(createError));
      } finally {
        if (isCurrentEpoch(epoch)) setBusyAction(null);
      }
    },
    [beginTransition, isCurrentEpoch, persistJobId]
  );

  const toggleSelection = useCallback((nextSelection: PlayerSelection) => {
    beginTransition();
    setSelections((current) => togglePlayerSelection(current, nextSelection));
  }, [beginTransition]);
  const setSelection = useCallback((nextSelection: PlayerSelection | null) => {
    beginTransition();
    setSelections(nextSelection ? [nextSelection] : []);
  }, [beginTransition]);
  const replaceSelections = useCallback(
    (nextSelections: PlayerSelection[]) => {
      beginTransition();
      setSelections(nextSelections);
    },
    [beginTransition]
  );
  const choosePlayerAnchors = useCallback(
    async (nextSelections: PlayerSelection[], profile: PlayerProfileInput) => {
      if (
        !jobId ||
        nextSelections.length < 1 ||
        nextSelections.length > MAX_PLAYER_SELECTIONS
      ) {
        return;
      }
      const epoch = beginTransition();
      const expectedAnalysisAttemptId = getTargetAnalysisAttemptId(job?.target);
      const primary = nextSelections[0];
      setBusyAction("select-player");
      setSelections([...nextSelections]);
      setError(null);
      try {
        const selectedAttemptId = await pickPlayer(
          jobId,
          primary.frame.key,
          primary.track.trackId,
          expectedAnalysisAttemptId
        );
        if (!isCurrentEpoch(epoch)) return;
        await savePlayerProfile(jobId, profile, selectedAttemptId);
        if (!isCurrentEpoch(epoch)) return;
        await confirmSelections(jobId, nextSelections, selectedAttemptId);
        if (!isCurrentEpoch(epoch)) return;
        await refresh(jobId, { silent: true, expectedEpoch: epoch });
      } catch (selectionError) {
        await reconcileMutationError(selectionError, jobId, epoch);
      } finally {
        if (isCurrentEpoch(epoch)) setBusyAction(null);
      }
    },
    [
      beginTransition,
      isCurrentEpoch,
      job,
      jobId,
      reconcileMutationError,
      refresh
    ]
  );
  const choosePlayer = useCallback(
    async (nextSelection: PlayerSelection, profile: PlayerProfileInput) =>
      choosePlayerAnchors([nextSelection], profile),
    [choosePlayerAnchors]
  );

  const enqueue = useCallback(async () => {
    if (!jobId) return;
    const epoch = beginTransition();
    const expectedAnalysisAttemptId = getTargetAnalysisAttemptId(job?.target);
    setBusyAction("enqueue");
    setError(null);
    try {
      await enqueueJob(jobId, expectedAnalysisAttemptId);
      if (!isCurrentEpoch(epoch)) return;
      await refresh(jobId, { silent: true, expectedEpoch: epoch });
    } catch (enqueueError) {
      await reconcileMutationError(enqueueError, jobId, epoch);
    } finally {
      if (isCurrentEpoch(epoch)) setBusyAction(null);
    }
  }, [
    beginTransition,
    isCurrentEpoch,
    job,
    jobId,
    reconcileMutationError,
    refresh
  ]);

  const retry = useCallback(
    async (
      force = false,
      expectedAnalysisAttemptId: string | null = null
    ) => {
      if (!jobId) return;
      const epoch = beginTransition();
      setBusyAction("retry");
      setError(null);
      try {
        await retryJob(jobId, { force, expectedAnalysisAttemptId });
        if (!isCurrentEpoch(epoch)) return;
        await refresh(jobId, { silent: true, expectedEpoch: epoch });
      } catch (retryError) {
        await reconcileMutationError(retryError, jobId, epoch);
      } finally {
        if (isCurrentEpoch(epoch)) setBusyAction(null);
      }
    },
    [
      beginTransition,
      isCurrentEpoch,
      jobId,
      reconcileMutationError,
      refresh
    ]
  );

  const reset = useCallback(() => {
    beginTransition();
    setJob(null);
    setJobId(null);
    setFrames([]);
    reselectionClearedJobId.current = null;
    setSelections([]);
    setError(null);
    setBusyAction(null);
    persistJobId(null);
  }, [beginTransition, persistJobId]);

  const stage = useMemo(() => getWorkflowStage(job, frames), [frames, job]);
  const isBusy = busyAction !== null;

  return {
    job,
    jobId,
    frames,
    selection,
    selections,
    stage,
    error,
    busyAction,
    isBusy,
    isBootstrapping,
    start,
    resume,
    refresh,
    choosePlayer,
    choosePlayerAnchors,
    enqueue,
    retry,
    reset,
    setSelection,
    setSelections: replaceSelections,
    toggleSelection
  };
}
