"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent
} from "react";
import {
  confirmJobSelection,
  createJob,
  enqueueJob,
  getJob,
  listJobFrames,
  saveJobPlayerRef,
  saveJobTargetSelection,
  type FrameSelection,
  type JobResponse,
  type JobFrame,
  type PreviewFrame,
  type TargetSelection
} from "@/lib/api";
import ProgressBar from "@/components/ProgressBar";
import ResultView from "@/components/ResultView";

const roles = ["Striker", "Winger", "Midfielder", "Defender", "Goalkeeper"];

const statusStyles: Record<string, string> = {
  QUEUED: "bg-slate-800 text-slate-200",
  WAITING_FOR_SELECTION: "bg-amber-500/20 text-amber-200",
  WAITING_FOR_PLAYER: "bg-amber-500/20 text-amber-200",
  RUNNING: "bg-blue-500/20 text-blue-200",
  COMPLETED: "bg-emerald-500/20 text-emerald-200",
  FAILED: "bg-rose-500/20 text-rose-200"
};

type PreviewDragState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type PreviewMode = "player-ref" | "target";

export default function JobRunner() {
  const [videoUrl, setVideoUrl] = useState("");
  const [role, setRole] = useState("Striker");
  const [category, setCategory] = useState("U17");
  const [shirtNumber, setShirtNumber] = useState<number>(9);
  const [teamName, setTeamName] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [targetSelection, setTargetSelection] = useState<TargetSelection | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [playerRefError, setPlayerRefError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingSelection, setSavingSelection] = useState(false);
  const [savingPlayerRef, setSavingPlayerRef] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("player-ref");
  const [selectedPreviewFrame, setSelectedPreviewFrame] = useState<PreviewFrame | null>(
    null
  );
  const [playerRefSelection, setPlayerRefSelection] = useState<FrameSelection | null>(
    null
  );
  const [previewDragState, setPreviewDragState] =
    useState<PreviewDragState | null>(null);
  const [refreshingFrames, setRefreshingFrames] = useState(false);
  const [previewFrames, setPreviewFrames] = useState<PreviewFrame[]>([]);
  const [previewPollingError, setPreviewPollingError] = useState<string | null>(
    null
  );
  const [previewPollingActive, setPreviewPollingActive] = useState(false);
  const [previewPollingAttempt, setPreviewPollingAttempt] = useState(0);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const previewModalRef = useRef<HTMLDivElement | null>(null);
  const previewCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const playerSectionRef = useRef<HTMLElement | null>(null);
  const targetSectionRef = useRef<HTMLDivElement | null>(null);

  const pct = job?.progress?.pct ?? 0;
  const step = job?.progress?.step ?? "—";
  const displayStatus = job?.status ?? "WAITING";
  const displayStatusLabelMap: Record<string, string> = {
    WAITING_FOR_PLAYER: "Select player",
    WAITING_FOR_SELECTION: "Select target",
    RUNNING: "running",
    COMPLETED: "completed"
  };
  const displayStatusLabel =
    displayStatusLabelMap[displayStatus] ?? displayStatus.toLowerCase();

  const statusClass = useMemo(() => {
    if (!displayStatus) {
      return "bg-slate-800 text-slate-200";
    }
    return statusStyles[displayStatus] ?? "bg-slate-800 text-slate-200";
  }, [displayStatus]);

  const jobPreviewFrames = job?.result?.previewFrames ?? [];
  const resolvedPreviewFrames =
    previewFrames.length > 0 ? previewFrames : jobPreviewFrames;
  const playerRef = job?.playerRef ?? job?.result?.playerRef ?? null;
  const shouldSelectPlayer = resolvedPreviewFrames.length > 0 && !playerRef;
  const jobTargetSelection = job?.target?.selections?.[0] ?? null;
  const hasTargetSelection = Boolean(targetSelection ?? jobTargetSelection);
  const isWaitingForPlayer = job?.status === "WAITING_FOR_PLAYER";
  const isWaitingForTarget = job?.status === "WAITING_FOR_SELECTION";
  const isExtractingPreviews = job?.progress?.step === "EXTRACTING_PREVIEWS";
  const showTargetSection =
    isWaitingForTarget || (isExtractingPreviews && resolvedPreviewFrames.length > 0);
  const showPreviewFrameLoader =
    jobId &&
    resolvedPreviewFrames.length === 0 &&
    (isExtractingPreviews || isWaitingForPlayer || isWaitingForTarget);

  const activePreviewRect = previewDragState
    ? {
        left: Math.min(previewDragState.startX, previewDragState.currentX),
        top: Math.min(previewDragState.startY, previewDragState.currentY),
        width: Math.abs(previewDragState.currentX - previewDragState.startX),
        height: Math.abs(previewDragState.currentY - previewDragState.startY)
      }
    : null;

  useEffect(() => {
    if (!jobId || !polling) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const data = await getJob(jobId);
        setJob(data);

        if (data.status === "COMPLETED" || data.status === "FAILED") {
          clearInterval(interval);
          setPolling(false);
        }
      } catch (pollError) {
        setError((pollError as Error).message);
        setPolling(false);
      }
    }, 2000);

    return () => {
      clearInterval(interval);
    };
  }, [jobId, polling]);

  useEffect(() => {
    if (!jobId) {
      return;
    }

    let isMounted = true;
    const fetchJob = async () => {
      try {
        const data = await getJob(jobId);
        if (isMounted) {
          setJob(data);
        }
      } catch (fetchError) {
        if (isMounted) {
          setError((fetchError as Error).message);
        }
      }
    };

    fetchJob();

    return () => {
      isMounted = false;
    };
  }, [jobId]);

  useEffect(() => {
    if (jobTargetSelection) {
      setTargetSelection(jobTargetSelection);
    }
  }, [jobTargetSelection]);

  useEffect(() => {
    if (!isExtractingPreviews) {
      setPreviewPollingActive(false);
    }
  }, [isExtractingPreviews]);

  useEffect(() => {
    if (!jobId) {
      setPreviewFrames([]);
      setPreviewPollingError(null);
      setPreviewPollingActive(false);
      setPreviewPollingAttempt(0);
      return;
    }

    if (jobPreviewFrames.length > 0) {
      setPreviewFrames(jobPreviewFrames);
      setPreviewPollingError(null);
      setPreviewPollingActive(false);
    }
  }, [jobId, jobPreviewFrames]);

  useEffect(() => {
    if (selectedPreviewFrame) {
      lastFocusedElementRef.current = document.activeElement as HTMLElement;
      requestAnimationFrame(() => {
        previewCloseButtonRef.current?.focus();
      });
    } else {
      lastFocusedElementRef.current?.focus();
    }
  }, [selectedPreviewFrame]);

  useEffect(() => {
    if (!jobId || !isExtractingPreviews || previewFrames.length > 0) {
      return;
    }

    if (previewPollingError || previewPollingActive) {
      return;
    }

    let isMounted = true;
    let attempts = 0;
    const maxAttempts = 20;
    const intervalMs = 1500;

    setPreviewPollingActive(true);

    const interval = setInterval(async () => {
      try {
        attempts += 1;
        const response = await listJobFrames(jobId);
        const items = response.items ?? [];

        if (!isMounted) {
          return;
        }

        if (items.length > 0) {
          const mappedFrames = items.map((frame, index) => {
            const timeSec =
              (frame as JobFrame & { time_sec?: number; timeSec?: number }).t ??
              (frame as JobFrame & { time_sec?: number; timeSec?: number })
                .time_sec ??
              (frame as JobFrame & { time_sec?: number; timeSec?: number }).timeSec ??
              0;
            const key =
              (frame as JobFrame & { key?: string }).key ??
              `frame-${timeSec}-${index}`;
            const signedUrl =
              (frame as JobFrame & { signedUrl?: string; signed_url?: string })
                .url ??
              (frame as JobFrame & { signedUrl?: string; signed_url?: string })
                .signedUrl ??
              (frame as JobFrame & { signedUrl?: string; signed_url?: string })
                .signed_url ??
              "";

            return {
              timeSec,
              key,
              signedUrl,
              width: frame.w ?? null,
              height: frame.h ?? null
            };
          });
          setPreviewFrames(mappedFrames);
          setPreviewPollingActive(false);
          setPreviewPollingError(null);
          clearInterval(interval);
          return;
        }

        if (attempts >= maxAttempts) {
          setPreviewPollingError("Preview polling timed out. Please retry.");
          setPreviewPollingActive(false);
          clearInterval(interval);
        }
      } catch (pollError) {
        if (!isMounted) {
          return;
        }
        setPreviewPollingError((pollError as Error).message);
        setPreviewPollingActive(false);
        clearInterval(interval);
      }
    }, intervalMs);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [
    jobId,
    isExtractingPreviews,
    previewFrames.length,
    previewPollingError,
    previewPollingActive,
    previewPollingAttempt
  ]);

  const handleCreateJob = async () => {
    setError(null);
    if (!videoUrl.trim()) {
      setError("Video URL is required.");
      return;
    }
    if (!teamName.trim()) {
      setError("Team name is required.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await createJob({
        video_url: videoUrl.trim(),
        role,
        category,
        shirt_number: Number(shirtNumber),
        team_name: teamName.trim()
      });
      const nextJobId = response.jobId ?? null;
      setJobId(nextJobId);
      setJob({ jobId: response.jobId, status: response.status });
      setTargetSelection(null);
      setSelectedPreviewFrame(null);
      setPlayerRefSelection(null);
      setPlayerRefError(null);
    } catch (createError) {
      setError((createError as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnqueue = async () => {
    if (!jobId) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const response = await enqueueJob(jobId);
      setJob(response);
      setPolling(true);
    } catch (enqueueError) {
      setError((enqueueError as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveSelection = async () => {
    if (!jobId || !targetSelection) {
      return;
    }
    setSelectionError(null);
    setSavingSelection(true);
    try {
      await saveJobTargetSelection(jobId, {
        selections: [targetSelection]
      });
      await confirmJobSelection(jobId);
      const updatedJob = await getJob(jobId);
      setJob(updatedJob);
      setPolling(true);
    } catch (saveError) {
      setSelectionError((saveError as Error).message);
    } finally {
      setSavingSelection(false);
    }
  };

  const handleOpenPreview = (frame: PreviewFrame, mode: PreviewMode) => {
    setPreviewMode(mode);
    setSelectedPreviewFrame(frame);
    setPlayerRefSelection(null);
    setPreviewDragState(null);
    setPlayerRefError(null);
  };

  const handleClosePreview = () => {
    setSelectedPreviewFrame(null);
    setPlayerRefSelection(null);
    setPreviewDragState(null);
  };

  const handlePreviewMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    const image = previewImageRef.current;
    if (!image) {
      return;
    }
    const rect = image.getBoundingClientRect();
    const startX = event.clientX - rect.left;
    const startY = event.clientY - rect.top;

    setPreviewDragState({
      startX,
      startY,
      currentX: startX,
      currentY: startY
    });
  };

  const handlePreviewMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!previewDragState) {
      return;
    }
    const image = previewImageRef.current;
    if (!image) {
      return;
    }
    const rect = image.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;
    setPreviewDragState((prev) =>
      prev
        ? {
            ...prev,
            currentX,
            currentY
          }
        : prev
    );
  };

  const handlePreviewMouseUp = () => {
    if (!previewDragState || !selectedPreviewFrame) {
      return;
    }
    const image = previewImageRef.current;
    if (!image) {
      setPreviewDragState(null);
      return;
    }
    const { startX, startY, currentX, currentY } = previewDragState;
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    if (width > 1 && height > 1) {
      if (previewMode === "player-ref") {
        setPlayerRefSelection({
          t: selectedPreviewFrame.timeSec,
          x: left / image.clientWidth,
          y: top / image.clientHeight,
          w: width / image.clientWidth,
          h: height / image.clientHeight
        });
      } else {
        setTargetSelection({
          frameTimeSec: selectedPreviewFrame.timeSec,
          x: left / image.clientWidth,
          y: top / image.clientHeight,
          w: width / image.clientWidth,
          h: height / image.clientHeight
        });
      }
    }
    setPreviewDragState(null);
  };

  const handlePreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      handleClosePreview();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const modal = previewModalRef.current;
    if (!modal) {
      return;
    }
    const focusable = Array.from(
      modal.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => !element.hasAttribute("disabled"));
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const isShift = event.shiftKey;
    const activeElement = document.activeElement as HTMLElement | null;

    if (isShift && activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!isShift && activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleSavePlayerRef = async () => {
    if (!jobId || !playerRefSelection) {
      return;
    }
    setPlayerRefError(null);
    setSavingPlayerRef(true);
    try {
      await saveJobPlayerRef(jobId, playerRefSelection);
      const updatedJob = await getJob(jobId);
      setJob(updatedJob);
      handleClosePreview();
    } catch (saveError) {
      setPlayerRefError((saveError as Error).message);
    } finally {
      setSavingPlayerRef(false);
    }
  };

  const handleStopPolling = () => {
    setPolling(false);
  };

  const handleRefreshJob = async () => {
    if (!jobId) {
      return;
    }
    setRefreshingFrames(true);
    setError(null);
    try {
      const updatedJob = await getJob(jobId);
      setJob(updatedJob);
    } catch (refreshError) {
      setError((refreshError as Error).message);
    } finally {
      setRefreshingFrames(false);
    }
  };

  const handleRetryPreviewPolling = () => {
    setPreviewPollingError(null);
    setPreviewPollingAttempt((prev) => prev + 1);
  };

  const handleFocusStep = () => {
    if (isWaitingForTarget) {
      targetSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
      return;
    }

    if (isWaitingForPlayer) {
      playerSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  };

  const handleReset = () => {
    setVideoUrl("");
    setRole("Striker");
    setCategory("U17");
    setShirtNumber(9);
    setTeamName("");
    setJobId(null);
    setJob(null);
    setTargetSelection(null);
    setError(null);
    setSelectionError(null);
    setPlayerRefError(null);
    setPolling(false);
    setSavingSelection(false);
    setSavingPlayerRef(false);
    setSelectedPreviewFrame(null);
    setPlayerRefSelection(null);
    setPreviewDragState(null);
    setPreviewFrames([]);
    setPreviewPollingError(null);
    setPreviewPollingActive(false);
    setPreviewPollingAttempt(0);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Create Job</h2>
            <p className="mt-1 text-sm text-slate-400">
              Provide the details for a new analysis request.
            </p>
          </div>
          <span className="rounded-full border border-slate-700 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-400">
            Form
          </span>
        </div>

        <div className="mt-6 space-y-4">
          <label className="block text-sm text-slate-300">
            Video URL
            <textarea
              value={videoUrl}
              onChange={(event) => setVideoUrl(event.target.value)}
              className="mt-2 h-24 w-full resize-none rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
              placeholder="https://..."
            />
          </label>

          <label className="block text-sm text-slate-300">
            Role
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            >
              {roles.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm text-slate-300">
            Category
            <input
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </label>

          <label className="block text-sm text-slate-300">
            Team name
            <input
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              required
            />
          </label>

          <label className="block text-sm text-slate-300">
            Shirt Number
            <input
              type="number"
              value={shirtNumber}
              onChange={(event) => setShirtNumber(Number(event.target.value))}
              className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleCreateJob}
            disabled={submitting}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create Job"}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500"
          >
            Reset
          </button>
        </div>

        {jobId ? (
          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Job Created
            </p>
            <p className="mt-2 text-sm text-slate-200">ID: {jobId}</p>
            <button
              type="button"
              onClick={handleEnqueue}
              disabled={
                submitting ||
                (job?.status === "WAITING_FOR_SELECTION" && !hasTargetSelection)
              }
              className="mt-3 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Enqueueing..." : "Enqueue"}
            </button>
            {job?.status === "WAITING_FOR_SELECTION" ? (
              <p className="mt-2 text-xs text-slate-500">
                Add a target box to unlock enqueue.
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
            {error}
          </div>
        ) : null}
      </section>

      <section
        ref={playerSectionRef}
        className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Select Player</h2>
            <p className="mt-1 text-sm text-slate-400">
              Choose the player to track before processing continues.
            </p>
          </div>
          <span className="rounded-full border border-slate-700 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-400">
            Step
          </span>
        </div>

        <div className="mt-6 space-y-4">
          {shouldSelectPlayer ? (
            <>
              <p className="text-sm text-slate-400">
                Click a preview frame to draw a bounding box around the player.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {resolvedPreviewFrames.map((frame, index) => (
                  <button
                    key={`${frame.key}-${index}`}
                    type="button"
                    onClick={() => handleOpenPreview(frame, "player-ref")}
                    className="group relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-left transition hover:border-emerald-400/60"
                  >
                    <img
                      src={frame.signedUrl}
                      alt={`Preview frame at ${frame.timeSec.toFixed(2)}s`}
                      className="h-32 w-full object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/50 to-transparent px-3 py-2">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-200">
                        t={frame.timeSec.toFixed(2)}s
                      </p>
                    </div>
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                You will be asked to draw one bounding box in the full-size view.
              </p>
            </>
          ) : (
            <div className="space-y-3 text-sm text-slate-400">
              {playerRef ? (
                <p>Player reference already saved.</p>
              ) : jobId ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-400" />
                    <span>
                      {previewPollingActive
                        ? "Preview frames are loading."
                        : "Waiting for previews."}
                    </span>
                  </div>
                  {previewPollingError ? (
                    <p className="text-xs text-rose-200">{previewPollingError}</p>
                  ) : null}
                  <button
                    type="button"
                    onClick={
                      previewPollingError ? handleRetryPreviewPolling : handleRefreshJob
                    }
                    disabled={previewPollingError ? false : refreshingFrames}
                    className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300 transition hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {previewPollingError
                      ? "Retry polling"
                      : refreshingFrames
                      ? "Refreshing..."
                      : "Retry"}
                  </button>
                </>
              ) : (
                <p>Create a job to load preview frames.</p>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Job Progress</h2>
            <p className="mt-1 text-sm text-slate-400">
              Monitor processing status and output.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${statusClass}`}
          >
            {displayStatusLabel}
          </span>
        </div>

        <div className="mt-6 space-y-4">
          <ProgressBar pct={pct} />
          {isWaitingForPlayer || isWaitingForTarget ? (
            <button
              type="button"
              onClick={handleFocusStep}
              className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left text-sm font-semibold text-amber-200 transition hover:border-amber-300/60"
            >
              {isWaitingForTarget ? "Select target now" : "Select player now"}
            </button>
          ) : null}

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Step
            </p>
            <p className="mt-2 text-sm text-slate-200">
              {step}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {job?.progress?.message ?? "No message"}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Created
              </p>
              <p className="mt-2 text-sm text-slate-200">
                {job?.createdAt ?? "—"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Updated
              </p>
              <p className="mt-2 text-sm text-slate-200">
                {job?.updatedAt ?? "—"}
              </p>
            </div>
          </div>

          {job?.error ? (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
              {job.error}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleStopPolling}
              disabled={!polling}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Stop polling
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500"
            >
              Reset
            </button>
          </div>
        </div>

        {showTargetSection ? (
          <div
            ref={targetSectionRef}
            className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6"
          >
            <div className="flex flex-col gap-2">
              <h3 className="text-lg font-semibold text-white">
                Select target (1 box)
              </h3>
              <p className="text-sm text-slate-400">
                Choose one preview frame and draw a bounding box around the
                target player.
              </p>
            </div>

            <div className="mt-4 space-y-4">
              {resolvedPreviewFrames.length === 0 ? (
                <div className="space-y-3 text-sm text-slate-400">
                  {showPreviewFrameLoader ? (
                    <div className="flex items-center gap-2">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-300/30 border-t-amber-300" />
                      <span>
                        {previewPollingActive
                          ? "Preview frames are loading."
                          : "Waiting for previews."}
                      </span>
                    </div>
                  ) : (
                    <p>No frames yet.</p>
                  )}
                  {previewPollingError ? (
                    <p className="text-xs text-rose-200">{previewPollingError}</p>
                  ) : null}
                  {jobId ? (
                    <button
                      type="button"
                      onClick={
                        previewPollingError
                          ? handleRetryPreviewPolling
                          : handleRefreshJob
                      }
                      disabled={previewPollingError ? false : refreshingFrames}
                      className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200 transition hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {previewPollingError
                        ? "Retry polling"
                        : refreshingFrames
                        ? "Refreshing..."
                        : "Retry"}
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {resolvedPreviewFrames.map((frame, index) => {
                    const isSelected =
                      targetSelection?.frameTimeSec === frame.timeSec;
                    return (
                      <button
                        key={`${frame.key}-${index}`}
                        type="button"
                        onClick={() => handleOpenPreview(frame, "target")}
                        className="group relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-left transition hover:border-amber-300/70"
                      >
                        <img
                          src={frame.signedUrl}
                          alt={`Preview frame at ${frame.timeSec.toFixed(2)}s`}
                          className="h-36 w-full object-cover"
                        />
                        {isSelected && targetSelection ? (
                          <div className="pointer-events-none absolute inset-0">
                            <div
                              className="absolute rounded border border-amber-400 bg-amber-400/20"
                              style={{
                                left: `${targetSelection.x * 100}%`,
                                top: `${targetSelection.y * 100}%`,
                                width: `${targetSelection.w * 100}%`,
                                height: `${targetSelection.h * 100}%`
                              }}
                            />
                          </div>
                        ) : null}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/50 to-transparent px-3 py-2">
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-200">
                            t={frame.timeSec.toFixed(2)}s
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleSaveSelection}
                  disabled={savingSelection || !targetSelection}
                  className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingSelection ? "Saving..." : "Save selection"}
                </button>
                <span className="text-xs text-slate-500">
                  {targetSelection
                    ? "Ready to save selection."
                    : "Select one box to continue."}
                </span>
              </div>
            </div>

            {selectionError ? (
              <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
                {selectionError}
              </div>
            ) : null}
          </div>
        ) : null}

        {job && job.status === "COMPLETED" ? <ResultView job={job} /> : null}
      </section>

      {selectedPreviewFrame ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div
            ref={previewModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-modal-title"
            aria-describedby="preview-modal-description"
            className="w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl"
            onKeyDown={handlePreviewKeyDown}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3
                  id="preview-modal-title"
                  className="text-lg font-semibold text-white"
                >
                  {previewMode === "target" ? "Draw target box" : "Draw player box"}
                </h3>
                <p
                  id="preview-modal-description"
                  className="mt-1 text-sm text-slate-400"
                >
                  {previewMode === "target"
                    ? "Drag to mark the target in the selected frame."
                    : "Drag to mark the player in the selected frame."}
                </p>
              </div>
              <button
                ref={previewCloseButtonRef}
                type="button"
                onClick={handleClosePreview}
                className="rounded-lg border border-slate-700 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-200 transition hover:border-slate-500"
              >
                Close
              </button>
            </div>

            <div
              className="relative mt-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-950"
              onMouseDown={handlePreviewMouseDown}
              onMouseMove={handlePreviewMouseMove}
              onMouseUp={handlePreviewMouseUp}
              onMouseLeave={handlePreviewMouseUp}
            >
              <img
                ref={previewImageRef}
                src={selectedPreviewFrame.signedUrl}
                alt={`Preview frame at ${selectedPreviewFrame.timeSec.toFixed(2)}s`}
                className="h-auto w-full select-none"
                draggable={false}
              />
              <div className="pointer-events-none absolute inset-0">
                {previewMode === "player-ref" && playerRefSelection ? (
                  <div
                    className="absolute rounded border border-emerald-400 bg-emerald-400/20"
                    style={{
                      left: `${playerRefSelection.x * 100}%`,
                      top: `${playerRefSelection.y * 100}%`,
                      width: `${playerRefSelection.w * 100}%`,
                      height: `${playerRefSelection.h * 100}%`
                    }}
                  />
                ) : null}
                {previewMode === "target" && targetSelection ? (
                  <div
                    className="absolute rounded border border-amber-400 bg-amber-400/20"
                    style={{
                      left: `${targetSelection.x * 100}%`,
                      top: `${targetSelection.y * 100}%`,
                      width: `${targetSelection.w * 100}%`,
                      height: `${targetSelection.h * 100}%`
                    }}
                  />
                ) : null}
                {activePreviewRect ? (
                  <div
                    className="absolute rounded border border-blue-400 bg-blue-400/20"
                    style={{
                      left: activePreviewRect.left,
                      top: activePreviewRect.top,
                      width: activePreviewRect.width,
                      height: activePreviewRect.height
                    }}
                  />
                ) : null}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-slate-400">
                {previewMode === "player-ref" && playerRefSelection
                  ? "Bounding box ready. Save to continue."
                  : previewMode === "target" && targetSelection
                  ? "Bounding box ready. Save to continue."
                  : previewMode === "target"
                  ? "Drag on the image to draw the target box."
                  : "Drag on the image to draw the player box."}
              </span>
              {previewMode === "player-ref" ? (
                <button
                  type="button"
                  onClick={handleSavePlayerRef}
                  disabled={!playerRefSelection || savingPlayerRef}
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingPlayerRef ? "Saving..." : "Save selection"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleClosePreview}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500"
                >
                  Use selection
                </button>
              )}
            </div>

            {playerRefError ? (
              <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
                {playerRefError}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
