import { useEffect, useRef, useState } from "react";
import type { PreviewFrame, PreviewFrameTrack } from "@/lib/api";

type PlayerPickerProps = {
  frame: PreviewFrame;
  frameSrc: string;
  selectedTrackId?: string | null;
  disabled?: boolean;
  onPick: (trackId: string, frameKey: string) => void;
};

type ImageSize = { width: number; height: number };

const formatScoreHint = (value: number | null | undefined) => {
  if (value === null || value === undefined) {
    return "—";
  }
  return value.toFixed(2);
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

export default function PlayerPicker({
  frame,
  frameSrc,
  selectedTrackId,
  disabled,
  onPick
}: PlayerPickerProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);

  useEffect(() => {
    const updateSize = () => {
      if (!imageRef.current) {
        return;
      }
      setImageSize({
        width: imageRef.current.clientWidth,
        height: imageRef.current.clientHeight
      });
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const tracks = frame.tracks ?? [];

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
            Player picker
          </p>
          <p className="mt-1 text-sm text-slate-200">
            Click a box to select the player.
          </p>
        </div>
        <span className="rounded-full border border-slate-700 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-400">
          Frame {frame.key}
        </span>
      </div>

      <div className="relative mt-4 overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
        {frameSrc ? (
          <img
            ref={imageRef}
            src={frameSrc}
            alt={`Preview frame ${frame.key}`}
            className="h-auto w-full select-none"
            onLoad={() => {
              if (!imageRef.current) {
                return;
              }
              setImageSize({
                width: imageRef.current.clientWidth,
                height: imageRef.current.clientHeight
              });
            }}
            draggable={false}
          />
        ) : (
          <div className="flex h-64 w-full items-center justify-center text-xs text-slate-400">
            Preview frame unavailable
          </div>
        )}

        <div className="absolute inset-0">
          {imageSize
            ? tracks.map((track) => {
                if (!isValidBBox(track)) {
                  return null;
                }
                const left = (track.x ?? 0) * imageSize.width;
                const top = (track.y ?? 0) * imageSize.height;
                const width = (track.w ?? 0) * imageSize.width;
                const height = (track.h ?? 0) * imageSize.height;
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
                    className={`pointer-events-auto absolute rounded border px-2 py-1 text-left text-[0.65rem] uppercase tracking-[0.15em] transition ${
                      isSelected
                        ? "border-emerald-300 bg-emerald-400/30 text-emerald-100"
                        : "border-amber-300/80 bg-slate-900/70 text-amber-100 hover:border-amber-200"
                    } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                    style={{
                      left: `${left}px`,
                      top: `${top}px`,
                      width: `${width}px`,
                      height: `${height}px`
                    }}
                  >
                    <span className="block font-semibold">
                      Track {track.trackId}
                    </span>
                    <span className="block text-[0.55rem] tracking-[0.2em] text-slate-200">
                      {track.tier ?? "tier ?"} · score {formatScoreHint(track.scoreHint)}
                    </span>
                  </button>
                );
              })
            : null}
        </div>
      </div>

      {tracks.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          No track overlays available for this frame yet.
        </p>
      ) : null}
    </div>
  );
}
