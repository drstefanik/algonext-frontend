export const statusLabels: Record<string, string> = {
  UPLOADING_INPUT: "Uploading video",
  WAITING_FOR_SELECTION: "Waiting for player selection",
  WAITING_FOR_PLAYER: "Waiting for player selection",
  WAITING_FOR_TARGET: "Waiting for target selection",
  ANALYZING: "Analysing match",
  RUNNING: "Analysing match",
  PROCESSING: "Analysing match",
  COMPLETED: "Completed",
  PARTIAL: "Completed (partial)",
  FAILED: "Failed",
  QUEUED: "Queued"
};

export const getStatusLabel = (status?: string | null) => {
  if (!status) {
    return "Waiting";
  }
  const normalized = status.trim().toUpperCase();
  return statusLabels[normalized] ?? status.toLowerCase();
};
