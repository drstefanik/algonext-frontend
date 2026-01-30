import type { PreviewFrame } from "@/lib/api";

type OverlayFramesGalleryProps = {
  frames: PreviewFrame[];
  getFrameSrc: (frame: PreviewFrame) => string;
  disabled?: boolean;
  onFrameError?: (frame: PreviewFrame) => void;
  onSelectFrame: (frame: PreviewFrame) => void;
};

const formatFrameTime = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  return value.toFixed(2);
};

export default function OverlayFramesGallery({
  frames,
  getFrameSrc,
  disabled,
  onFrameError,
  onSelectFrame
}: OverlayFramesGalleryProps) {
  if (frames.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-sm text-slate-400">
        No preview frames available yet.
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {frames.map((frame, index) => {
        const frameSrc = getFrameSrc(frame);
        return (
          <button
            key={`${frame.key}-${index}`}
            type="button"
            onClick={() => onSelectFrame(frame)}
            disabled={disabled}
            className={`overflow-hidden rounded-xl border bg-slate-950 text-left transition ${
              disabled
                ? "cursor-not-allowed border-slate-800 opacity-60"
                : "border-slate-800 hover:border-emerald-400/60"
            }`}
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
            </div>

            <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-slate-400">
              <span className="uppercase tracking-[0.2em] text-slate-500">
                t={formatFrameTime(frame.timeSec)}
              </span>
              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-slate-500">
                Draw box
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
