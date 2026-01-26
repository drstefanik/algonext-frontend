"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
  type MouseEvent
} from "react";
import {
  createJob,
  enqueueJob,
  getJob,
  listJobFrames,
  normalizeJob,
  saveJobPlayerRef,
  saveJobTargetSelection,
  type FrameItem,
  type FrameSelection,
  type JobResponse,
  type PreviewFrame,
  type TargetSelection
} from "@/lib/api";
import ProgressBar from "@/components/ProgressBar";
import ResultView from "@/components/ResultView";

const roles = ["Striker", "Winger", "Midfielder", "Defender", "Goalkeeper"];
const POLLING_TIMEOUT_MS = 12000;
const REQUIRED_FRAME_COUNT = 8;

const FrameSelector = ({ children }: { children: ReactNode }) => <>{children}</>;

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

const formatFrameTime = (timeSec: number | null) =>
  timeSec === null ? "—" : `${timeSec.toFixed(2)}s`;

const formatFrameAlt = (timeSec: number | null) =>
  timeSec === null ? "Preview frame (time unknown)" : `Preview frame at ${timeSec.toFixed(2)}s`;

const mapFrameItemToPreviewFrame = (
  frame: FrameItem,
  index: number
): PreviewFrame => {
  const timeSec = coerceNumber(frame.time_sec);
  const key = frame.key ?? `frame-${timeSec}-${index}`;
  return {
    timeSec,
    key,
    url: frame.url,
    signedUrl: frame.url,
    width: frame.width ?? null,
    height: frame.height ?? null
  };
};

const buildHttpErrorMessage = async (response: Response) => {
  let message = "";

  try {
    const data = (await response.clone().json()) as
      | {
          error?: string | { message?: string };
          detail?: unknown;
          progress?: { message?: string };
          message?: string;
        }
      | undefined;
    if (data) {
      const detail = data.detail;
      if (typeof detail === "string") {
        message = detail;
      } else if (Array.isArray(detail)) {
        message = detail
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
          .filter(Boolean)
          .join("; ");
      }

      if (!message) {
        message =
          (typeof data.error === "object" ? data.error?.message : data.error) ??
          data.progress?.message ??
          data.message ??
          "";
      }
    }
  } catch {
    // ignore json parse errors
  }

  if (!message) {
    try {
      message = await response.text();
    } catch {
      // ignore text parse errors
    }
  }

  if (!message) {
    message = response.statusText || "Unexpected error";
  }

  return message;
};

const extractNestedErrorMessage = (error: unknown) => {
  if (!error || typeof error !== "object") {
    return null;
  }

  if ("message" in error && typeof error.message === "string") {
    return error.message;
  }

  if ("error" in error) {
    const nestedError = (error as { error?: unknown }).error;
    if (typeof nestedError === "string") {
      return nestedError;
    }
    if (
      nestedError &&
      typeof nestedError === "object" &&
      "message" in nestedError &&
      typeof nestedError.message === "string"
    ) {
      return nestedError.message;
    }
  }

  if ("detail" in error) {
    const detail = (error as { detail?: unknown }).detail;
    if (typeof detail === "string") {
      return detail;
    }
    if (Array.isArray(detail)) {
      const message = detail
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
        .filter(Boolean)
        .join("; ");
      if (message) {
        return message;
      }
    }
    if (
      detail &&
      typeof detail === "object" &&
      "error" in detail &&
      detail.error &&
      typeof detail.error === "object" &&
      "message" in detail.error &&
      typeof detail.error.message === "string"
    ) {
      return detail.error.message;
    }
  }

  if ("progress" in error) {
    const progress = (error as { progress?: unknown }).progress;
    if (progress && typeof progress === "object" && "message" in progress) {
      const progressMessage = progress.message;
      if (typeof progressMessage === "string") {
        return progressMessage;
      }
    }
  }

  return null;
};

const toErrorMessage = (error: unknown) => {
  const nestedMessage = extractNestedErrorMessage(error);
  if (nestedMessage) {
    return nestedMessage;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    const serialized = JSON.stringify(error);
    return serialized ?? "Unexpected error";
  } catch {
    return "Unexpected error";
  }
};

const fetchJsonWithTimeout = async <T,>(input: RequestInfo | URL) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), POLLING_TIMEOUT_MS);

  try {
    const response = await fetch(input, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      const message = await buildHttpErrorMessage(response);
      throw new Error(message);
    }

    return (await response.json()) as T;
  } catch (fetchError) {
    if (fetchError instanceof Error && fetchError.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw fetchError;
  } finally {
    clearTimeout(timeoutId);
  }
};

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
  const [selectionSuccess, setSelectionSuccess] = useState<string | null>(null);
  const [playerRefError, setPlayerRefError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingSelection, setSavingSelection] = useState(false);
  const [savingPlayerRef, setSavingPlayerRef] = useState(false);
  const [gridMode, setGridMode] = useState<PreviewMode>("player-ref");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("player-ref");
  const [selectedPreviewFrame, setSelectedPreviewFrame] = useState<PreviewFrame | null>(
    null
  );
  const [playerRefSelection, setPlayerRefSelection] = useState<FrameSelection | null>(
    null
  );
  const [playerSaved, setPlayerSaved] = useState(false);
  const [targetSaved, setTargetSaved] = useState(false);
  const [previewDragState, setPreviewDragState] =
    useState<PreviewDragState | null>(null);
  const [refreshingFrames, setRefreshingFrames] = useState(false);
  const [previewFrames, setPreviewFrames] = useState<PreviewFrame[]>([]);
  const [framesFrozen, setFramesFrozen] = useState(false);
  const [previewPollingError, setPreviewPollingError] = useState<string | null>(
    null
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewImageErrors, setPreviewImageErrors] = useState<Record<string, string>>(
    {}
  );
  const [previewPollingActive, setPreviewPollingActive] = useState(false);
  const [previewPollingAttempt, setPreviewPollingAttempt] = useState(0);
  const previewListRequestRef = useRef(0);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const previewModalRef = useRef<HTMLDivElement | null>(null);
  const previewCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const playerSectionRef = useRef<HTMLElement | null>(null);

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

  const resolvedPreviewFrames = previewFrames;
  const hasFullPreviewSet = resolvedPreviewFrames.length >= REQUIRED_FRAME_COUNT;
  const previewImageErrorCount = Object.keys(previewImageErrors).length;
  const hasPreviewFrameErrors =
    resolvedPreviewFrames.length > 0 && previewImageErrorCount > 0;
  const playerRef = job?.playerRef ?? null;
  const jobTargetSelection = job?.target?.selections?.[0] ?? null;
  const hasPlayer = Boolean(job?.playerRef);
  const hasTarget =
    Array.isArray(job?.target?.selections) && job.target.selections.length > 0;
  const status = job?.status ?? null;
  const previewsReady = hasFullPreviewSet;
  const effectiveStep: "PLAYER" | "TARGET" | "PROCESSING" | "IDLE" = !jobId
    ? "IDLE"
    : status === "RUNNING" || status === "QUEUED"
      ? "PROCESSING"
      : previewsReady && !hasPlayer
        ? "PLAYER"
        : previewsReady && hasPlayer && !hasTarget
          ? "TARGET"
          : "PROCESSING";
  const showPlayerSection = effectiveStep === "PLAYER";
  const showTargetSection = effectiveStep === "TARGET";
  const selectionReady = previewsReady && (showPlayerSection || showTargetSection);
  const isExtractingPreviews = job?.progress?.step === "EXTRACTING_PREVIEWS";
  const isPreviewsReady = job?.progress?.step === "PREVIEWS_READY";
  const canEnqueue =
    Boolean(job?.playerRef) && Boolean(job?.target?.selections?.length);
  const enqueueHint = !playerSaved
    ? "Missing Player selection"
    : !targetSaved
      ? "Missing Target selection"
      : "Ready";
  const shouldPollFrames =
    Boolean(jobId) &&
    (isExtractingPreviews || isPreviewsReady || selectionReady);
  const shouldPollFrameList = shouldPollFrames && !framesFrozen;
  const frameSelectorKey = jobId ?? "frame-selector";

  const activePreviewRect = previewDragState
    ? {
        left: Math.min(previewDragState.startX, previewDragState.currentX),
        top: Math.min(previewDragState.startY, previewDragState.currentY),
        width: Math.abs(previewDragState.currentX - previewDragState.startX),
        height: Math.abs(previewDragState.currentY - previewDragState.startY)
      }
    : null;

  const getPreviewFrameSrc = (frame: PreviewFrame) => {
    const signedUrl = frame.signedUrl ?? frame.url ?? "";
    if (!signedUrl) {
      return "";
    }
    return `/api/frame-proxy?url=${encodeURIComponent(signedUrl)}`;
  };

  const handlePreviewImageError = (frame: PreviewFrame, context: string) => {
    console.error("FRAME_IMG_ERROR", {
      context,
      key: frame.key,
      url: frame.url ?? frame.signedUrl
    });
    setPreviewImageErrors((prev) => ({
      ...prev,
      [frame.key]: context
    }));
  };

  const handlePreviewImageLoad = (frame: PreviewFrame) => {
    setPreviewImageErrors((prev) => {
      if (!prev[frame.key]) {
        return prev;
      }
      const next = { ...prev };
      delete next[frame.key];
      return next;
    });
  };

  useEffect(() => {
    if (!jobId || !polling) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const data = await fetchJsonWithTimeout<JobResponse>(`/api/jobs/${jobId}`);
        const normalizedJob = normalizeJob(data);
        setJob(normalizedJob);

        if (normalizedJob.status === "COMPLETED" || normalizedJob.status === "FAILED") {
          clearInterval(interval);
          setPolling(false);
        }
      } catch (pollError) {
        clearInterval(interval);
        setError(toErrorMessage(pollError));
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
          setJob(normalizeJob(data));
        }
      } catch (fetchError) {
        if (isMounted) {
          setError(toErrorMessage(fetchError));
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
    setPlayerSaved(Boolean(job?.playerRef));
    setTargetSaved(Boolean(job?.target?.selections?.length));
  }, [job?.playerRef, job?.target?.selections?.length]);

  useEffect(() => {
    if (!shouldPollFrameList) {
      setPreviewPollingActive(false);
    }
  }, [shouldPollFrameList]);

  useEffect(() => {
    if (!jobId) {
      setPreviewFrames([]);
      setFramesFrozen(false);
      setPreviewPollingError(null);
      setPreviewPollingActive(false);
      setPreviewPollingAttempt(0);
      setPreviewImageErrors({});
      setPreviewError(null);
      previewListRequestRef.current = 0;
      return;
    }
  }, [jobId]);

  useEffect(() => {
    if (jobId) {
      setFramesFrozen(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId || !shouldPollFrameList) {
      return;
    }

    let isMounted = true;
    const requestId = Date.now();
    previewListRequestRef.current = requestId;
    let attempts = 0;
    const maxAttempts = 30;
    const intervalMs = 1500;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = () => {
      setPreviewPollingActive(true);
      listJobFrames(jobId)
        .then(({ items }) => {
          if (!isMounted) {
            return;
          }
          if (previewListRequestRef.current !== requestId) {
            return;
          }

          if (!framesFrozen) {
            const mappedFrames = items.map(mapFrameItemToPreviewFrame);
            setPreviewFrames(mappedFrames);
          }
          setPreviewError(null);
          setPreviewPollingError(null);

          if (items.length >= REQUIRED_FRAME_COUNT) {
            setPreviewPollingActive(false);
            return;
          }

          attempts += 1;
          if (
            shouldPollFrameList &&
            items.length < REQUIRED_FRAME_COUNT &&
            attempts < maxAttempts
          ) {
            timeoutId = setTimeout(poll, intervalMs);
            return;
          }

          if (
            shouldPollFrameList &&
            items.length < REQUIRED_FRAME_COUNT &&
            attempts >= maxAttempts
          ) {
            setPreviewPollingError("Preview polling timed out. Please retry.");
          }
          setPreviewPollingActive(false);
        })
        .catch((fetchError) => {
          if (!isMounted) {
            return;
          }
          if (previewListRequestRef.current !== requestId) {
            return;
          }

          const message = String(fetchError?.message || fetchError);
          setPreviewError(message);
          setPreviewPollingError(message);

          attempts += 1;
          if (shouldPollFrameList && attempts < maxAttempts) {
            timeoutId = setTimeout(poll, intervalMs);
            return;
          }
          setPreviewPollingActive(false);
        });
    };

    poll();

    return () => {
      isMounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [
    jobId,
    shouldPollFrameList,
    previewPollingAttempt,
    framesFrozen
  ]);

  useEffect(() => {
    console.log("PREVIEW_DEBUG", {
      status: job?.status ?? null,
      step: job?.progress?.step ?? null,
      previewFramesState: previewFrames.length,
      previewFramesResolved: resolvedPreviewFrames.length,
      previewImageErrorCount
    });
  }, [
    job?.status,
    job?.progress?.step,
    previewFrames.length,
    resolvedPreviewFrames.length,
    previewImageErrorCount
  ]);

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

  const handleCreateJob = async () => {
    setError(null);
    const trimmedVideo = videoUrl.trim();
    if (!trimmedVideo) {
      setError("Video URL or key is required.");
      return;
    }
    if (!teamName.trim()) {
      setError("Team name is required.");
      return;
    }

    setSubmitting(true);
    try {
      const isHttpUrl = /^https?:\/\//i.test(trimmedVideo);
      const response = await createJob({
        ...(isHttpUrl
          ? { video_url: trimmedVideo }
          : { video_key: trimmedVideo, video_bucket: "fnh" }),
        role,
        category,
        shirt_number: Number(shirtNumber),
        team_name: teamName.trim()
      });
      const nextJobId = response.jobId ?? null;
      setJobId(nextJobId);
      setJob({ jobId: response.jobId, status: response.status });
      setTargetSelection(null);
      setSelectionSuccess(null);
      setSelectedPreviewFrame(null);
      setPlayerRefSelection(null);
      setPlayerRefError(null);
      setPlayerSaved(false);
      setTargetSaved(false);
      setGridMode("player-ref");
    } catch (createError) {
      setError(toErrorMessage(createError));
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnqueue = async () => {
    if (!jobId) {
      return;
    }
    if (!canEnqueue) {
      setError("Prima salva Player Box e Target Box.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const response = await enqueueJob(jobId);
      setJob(normalizeJob(response));
      setPolling(true);
      setFramesFrozen(true);
      setSelectedPreviewFrame(null);
    } catch (enqueueError) {
      setError(toErrorMessage(enqueueError));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveSelection = async () => {
    if (!jobId || !targetSelection) {
      return;
    }
    setSelectionError(null);
    setSelectionSuccess(null);
    setSavingSelection(true);
    try {
      await saveJobTargetSelection(jobId, {
        selections: [targetSelection]
      });
      const updatedJob = await getJob(jobId);
      setJob(updatedJob);
      setSelectionSuccess("Selection saved");
    } catch (saveError) {
      setSelectionError(toErrorMessage(saveError));
    } finally {
      setSavingSelection(false);
    }
  };

  const handleOpenPreview = (frame: PreviewFrame, mode: PreviewMode) => {
    if (mode === "target" && !hasPlayer) {
      setError("Save Player Box first.");
      return;
    }
    if (!hasFullPreviewSet) {
      setError("Wait for 8/8 preview frames.");
      return;
    }
    setPreviewMode(mode);
    setFramesFrozen(true);
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
          frameTimeSec: selectedPreviewFrame.timeSec,
          x: left / image.clientWidth,
          y: top / image.clientHeight,
          w: width / image.clientWidth,
          h: height / image.clientHeight
        });
      } else {
        setSelectionSuccess(null);
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
      const response = await saveJobPlayerRef(jobId, playerRefSelection);
      const responseSource =
        response && typeof response === "object" && "data" in response
          ? (response as { data?: unknown }).data
          : response;
      if (
        responseSource &&
        typeof responseSource === "object" &&
        ("player_ref" in responseSource || "playerRef" in responseSource)
      ) {
        const playerRefValue =
          (responseSource as { player_ref?: unknown }).player_ref ??
          (responseSource as { playerRef?: unknown }).playerRef ??
          null;
        if (playerRefValue === null) {
          setPlayerRefError(
            "Backend did not persist player_ref (null). Check payload keys."
          );
          return;
        }
      }
      const updatedJob = await getJob(jobId);
      setJob(updatedJob);
      handleClosePreview();
    } catch (saveError) {
      setPlayerRefError(toErrorMessage(saveError));
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
      setJob(normalizeJob(updatedJob));
    } catch (refreshError) {
      setError(toErrorMessage(refreshError));
    } finally {
      setRefreshingFrames(false);
    }
  };

  const handleRetryPreviewPolling = () => {
    setPreviewPollingError(null);
    setPreviewPollingAttempt((prev) => prev + 1);
  };

  const handleFocusStep = () => {
    if (effectiveStep === "TARGET") {
      setGridMode("target");
      playerSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
      return;
    }

    if (effectiveStep === "PLAYER") {
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
    setSelectionSuccess(null);
    setPlayerRefError(null);
    setPolling(false);
    setSavingSelection(false);
    setSavingPlayerRef(false);
    setSelectedPreviewFrame(null);
    setPlayerRefSelection(null);
    setPlayerSaved(false);
    setTargetSaved(false);
    setGridMode("player-ref");
    setPreviewDragState(null);
    setPreviewFrames([]);
    setFramesFrozen(false);
    setPreviewPollingError(null);
    setPreviewPollingActive(false);
    setPreviewPollingAttempt(0);
    setPreviewImageErrors({});
    previewListRequestRef.current = 0;
  };

  const handleSelectTargetFromFrames = () => {
    setGridMode("target");
    playerSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };

  const playerRefMissingTime = playerRefSelection?.frameTimeSec == null;
  const targetMissingTime = targetSelection?.frameTimeSec == null;
  const selectedFrameMissingTime = selectedPreviewFrame?.timeSec == null;

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
            Video URL (http/https) or MinIO Object Key
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
              disabled={submitting}
              aria-disabled={!canEnqueue || submitting}
              className={`mt-3 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-400 ${
                !canEnqueue || submitting ? "cursor-not-allowed opacity-50" : ""
              }`}
            >
              {submitting ? "Enqueueing..." : "Enqueue"}
            </button>
            <p className="mt-2 text-xs text-slate-500">{enqueueHint}</p>
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
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
            <p className="text-[0.65rem] uppercase tracking-[0.2em] text-slate-500">
              Preview debug
            </p>
            <div className="mt-2 grid gap-1">
              <span>Status: {job?.status ?? "—"}</span>
              <span>Step: {job?.progress?.step ?? "—"}</span>
              <span>Frames (payload): {job?.previewFrames?.length ?? 0}</span>
              <span>Frames (list): {previewFrames.length}</span>
              <span>Frames (resolved): {resolvedPreviewFrames.length}</span>
              <span>Frames error: {previewError || "—"}</span>
              <span>Image errors: {previewImageErrorCount}</span>
              <span>playerSaved: {String(playerSaved)}</span>
              <span>targetSaved: {String(targetSaved)}</span>
              <span>
                playerRef(raw):{" "}
                {JSON.stringify(
                  job?.playerRef ??
                    (job as any)?.player_ref ??
                    job?.result?.playerRef ??
                    job?.result?.player_ref ??
                    null
                )}
              </span>
              <span>
                target(raw):{" "}
                {JSON.stringify(job?.target ?? (job as any)?.data?.target ?? null)}
              </span>
            </div>
          </div>
          {hasPreviewFrameErrors ? (
            <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-200">
              Images blocked or failed to load. Check the frame proxy or mixed
              content settings.
            </div>
          ) : null}
          {jobId ? (
            previewsReady ? (
              <FrameSelector key={frameSelectorKey}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-slate-400">
                    {gridMode === "player-ref"
                      ? "Click a preview frame to draw a bounding box around the player."
                      : "Click a preview frame to draw a bounding box around the target."}
                  </p>
                  <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950 p-1">
                    <button
                      type="button"
                      onClick={() => setGridMode("player-ref")}
                      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                        gridMode === "player-ref"
                          ? "bg-emerald-400 text-slate-950"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      Player
                    </button>
                    <button
                      type="button"
                      onClick={() => setGridMode("target")}
                      className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                        gridMode === "target"
                          ? "bg-amber-300 text-slate-950"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      Target
                    </button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {resolvedPreviewFrames.map((frame, index) => (
                    <button
                      key={`${frame.key}-${index}`}
                      type="button"
                      onClick={() => handleOpenPreview(frame, gridMode)}
                      className={`group relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-left transition ${
                        gridMode === "target"
                          ? "hover:border-amber-300/70"
                          : "hover:border-emerald-400/60"
                      }`}
                    >
                      {previewImageErrors[frame.key] ? (
                        <div className="flex h-32 w-full items-center justify-center bg-slate-900 text-xs text-slate-400">
                          Image blocked
                        </div>
                      ) : (
                        <img
                          src={getPreviewFrameSrc(frame)}
                          alt={formatFrameAlt(frame.timeSec)}
                          className="h-32 w-full object-cover"
                          onLoad={() => handlePreviewImageLoad(frame)}
                          onError={() => handlePreviewImageError(frame, "player-grid")}
                        />
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/50 to-transparent px-3 py-2">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-200">
                          t={formatFrameTime(frame.timeSec)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500">
                  You will be asked to draw one bounding box in the full-size view.
                </p>
              </FrameSelector>
            ) : (
              <div className="space-y-3 text-sm text-slate-400">
                {playerRef ? (
                  <p>Player reference already saved.</p>
                ) : (
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
                        previewPollingError
                          ? handleRetryPreviewPolling
                          : handleRefreshJob
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
                )}
              </div>
            )
          ) : (
            <div className="space-y-3 text-sm text-slate-400">
              <p>Create a job to load preview frames.</p>
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
          {effectiveStep === "TARGET" || effectiveStep === "PLAYER" ? (
            <button
              type="button"
              onClick={handleFocusStep}
              className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left text-sm font-semibold text-amber-200 transition hover:border-amber-300/60"
            >
              {effectiveStep === "TARGET"
                ? "Select target now"
                : "Select player now"}
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

        {jobId ? (
          <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-lg font-semibold text-white">Target</h3>
                <p className="text-sm text-slate-400">
                  {targetSaved ? "Target saved" : "Missing target"}
                </p>
              </div>
              {gridMode === "target" ? (
                <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">
                  Target mode on
                </span>
              ) : null}
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <button
                type="button"
                onClick={handleSelectTargetFromFrames}
                disabled={!previewsReady}
                className="rounded-lg border border-amber-300/40 px-4 py-2 text-sm font-semibold text-amber-200 transition hover:border-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Select target from frames
              </button>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleSaveSelection}
                  disabled={savingSelection || !targetSelection || targetMissingTime}
                  className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingSelection ? "Saving..." : "Save selection"}
                </button>
                <span className="text-xs text-slate-500">
                  {targetMissingTime
                    ? "Frame missing time_sec."
                    : targetSelection
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
            {selectionSuccess ? (
              <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                {selectionSuccess}
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
              {previewImageErrors[selectedPreviewFrame.key] ? (
                <div className="flex h-72 w-full items-center justify-center text-xs text-slate-400">
                  Image blocked. Check the frame proxy or mixed content settings.
                </div>
              ) : (
                <img
                  ref={previewImageRef}
                  src={getPreviewFrameSrc(selectedPreviewFrame)}
                  alt={formatFrameAlt(selectedPreviewFrame.timeSec)}
                  className="h-auto w-full select-none"
                  draggable={false}
                  onLoad={() => handlePreviewImageLoad(selectedPreviewFrame)}
                  onError={() =>
                    handlePreviewImageError(selectedPreviewFrame, "preview-modal")
                  }
                />
              )}
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
                {selectedFrameMissingTime
                  ? "Frame missing time_sec."
                  : previewMode === "player-ref" && playerRefSelection
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
                  disabled={!playerRefSelection || savingPlayerRef || playerRefMissingTime}
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
