import type { PreviewFrame, PreviewFrameTrack } from "@/lib/api";

type OverlayFramesGalleryProps = {
  frames: PreviewFrame[];
  getFrameSrc: (frame: PreviewFrame) => string;
  selectedTrackId?: string | null;
  disabled?: boolean;
  overlayReady?: boolean;
  onFrameError?: (frame: PreviewFrame) => void;
  onPick: (trackId: string, frameKey: string) => void;
};

const isValidBBox = (track: PreviewFrameTrack) =>
  track.x !== null &&
  track.x !== undefined &&
  track.y !== null &&
  track.y !== undefined &&
  track.w !== null &&
  track.w !== undefined &&
  track.h !== null &&
  track.h !== undefined;

const formatFrameTime = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return value.toFixed(2);
};

const getTrackTone = (track: PreviewFrameTrack) => {
  const tier = (track.tier ?? "").toString().toLowerCase();
  if (tier.includes("s") || tier.includes("a")) {
    return "emerald";
  }
  if (tier.includes("b") || tier.includes("c")) {
    return "amber";
  }
  const score = track.scoreHint ?? null;
  if (score !== null && score >= 0.8) {
    return "emerald";
  }
  if (score !== null && score >= 0.5) {
    return "amber";
  }
  return "slate";
};

const toneClasses: Record<string, string> = {
  emerald:
    "border-emerald-300/70 bg-emerald-400/20 text-emerald-100 hover:border-emerald-200",
  amber:
    "border-amber-300/80 bg-amber-400/20 text-amber-100 hover:border-amber-200",
  slate:
    "border-slate-300/60 bg-slate-900/70 text-slate-200 hover:border-slate-200"
};

export default function OverlayFramesGallery({
  frames,
  getFrameSrc,
  selectedTrackId,
  disabled,
  overlayReady = true,
  onFrameError,
  onPick
}: OverlayFramesGalleryProps) {
  if (frames.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-sm text-slate-400">
        {overlayReady ? "No preview frames available yet." : "Calcolo giocatori in corso…"}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {frames.map((frame, index) => {
        const frameSrc = getFrameSrc(frame);
        const tracks = frame.tracks ?? [];
        const showTrackCount = overlayReady;
        return (
          <div
            key={`${frame.key}-${index}`}
            className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950"
          >
            <div className="relative overflow-hidden bg-slate-900">
              {frameSrc ? (
                <img
                  src={frameSrc}
                  alt={`Overlay frame ${frame.key}`}
                  className="h-48 w-full object-cover"
                  draggable={false}
                  onError={() => onFrameError?.(frame)}
                />
              ) : (
                <div className="flex h-48 w-full items-center justify-center text-xs text-slate-400">
                  Preview frame unavailable
                </div>
              )}

              <div className="absolute inset-0">
                {tracks.map((track) => {
                  if (!isValidBBox(track)) {
                    return null;
                  }
                  const tone = getTrackTone(track);
                  const isSelected = selectedTrackId === track.trackId;
                  return (
                    <button
                      key={`${frame.key}-${track.trackId}`}
                      type="button"
                      aria-pressed={isSelected}
                      disabled={disabled}
                      onClick={(event) => {
                        event.preventDefault();
                        if (disabled) {
                          return;
                        }
                        onPick(track.trackId, frame.key);
                      }}
                      className={`pointer-events-auto absolute flex items-start justify-between rounded border px-1.5 py-1 text-left text-[0.6rem] font-semibold uppercase tracking-[0.12em] transition ${
                        toneClasses[tone]
                      } ${isSelected ? "ring-2 ring-emerald-300/70" : ""} ${
                        disabled ? "cursor-not-allowed opacity-60" : ""
                      }`}
                      style={{
                        left: `${(track.x ?? 0) * 100}%`,
                        top: `${(track.y ?? 0) * 100}%`,
                        width: `${(track.w ?? 0) * 100}%`,
                        height: `${(track.h ?? 0) * 100}%`
                      }}
                    >
                      <span>#{track.trackId}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-slate-400">
              <span className="uppercase tracking-[0.2em] text-slate-500">
                t={formatFrameTime(frame.timeSec)}
              </span>
              {showTrackCount ? (
                tracks.length > 0 ? (
                  <span>{tracks.length} tracks</span>
                ) : (
                  <span title="Nessun giocatore rilevato in questo frame">
                    Nessun giocatore
                  </span>
                )
              ) : (
                <span>Calcolo in corso…</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
