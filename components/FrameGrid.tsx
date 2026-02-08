"use client";

import { useState } from "react";
import type { PreviewFrame } from "@/lib/api";

const gridClassName =
  "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

type FrameGridProps = {
  frames: PreviewFrame[];
  getFrameSrc: (frame: PreviewFrame) => string;
  onSelectFrame: (frame: PreviewFrame) => void;
  formatFrameTime: (timeSec: number | null) => string;
  formatFrameAlt: (timeSec: number | null) => string;
  imageErrors?: Record<string, string>;
  onImageError?: (frame: PreviewFrame) => void;
  onImageLoad?: (frame: PreviewFrame) => void;
  limit?: number;
  accent?: "player" | "target" | "system";
};

const accentClasses: Record<NonNullable<FrameGridProps["accent"]>, string> = {
  player: "hover:border-emerald-400/60",
  target: "hover:border-amber-300/70",
  system: "hover:border-blue-400/60"
};

export default function FrameGrid({
  frames,
  getFrameSrc,
  onSelectFrame,
  formatFrameTime,
  formatFrameAlt,
  imageErrors,
  onImageError,
  onImageLoad,
  limit = 12,
  accent = "system"
}: FrameGridProps) {
  const [open, setOpen] = useState(false);
  const visibleFrames = frames.slice(0, limit);
  const hasMore = frames.length > limit;

  return (
    <div className="space-y-3">
      <div className={gridClassName}>
        {visibleFrames.map((frame, index) => {
          const hasError = Boolean(imageErrors?.[frame.key]);
          return (
          <button
            key={`${frame.key}-${index}`}
            type="button"
            onClick={() => onSelectFrame(frame)}
            className={`group relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-left transition ${
              accentClasses[accent]
            }`}
          >
            {hasError ? (
              <div className="flex h-28 w-full items-center justify-center bg-slate-900 text-xs text-slate-400">
                Image blocked
              </div>
            ) : (
              <img
                src={getFrameSrc(frame)}
                alt={formatFrameAlt(frame.timeSec)}
                className="h-28 w-full object-cover"
                loading="lazy"
                decoding="async"
                onLoad={() => onImageLoad?.(frame)}
                onError={() => onImageError?.(frame)}
              />
            )}
            <div className="absolute inset-0 bg-slate-950/40 opacity-0 transition group-hover:opacity-100" />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent px-3 py-2">
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-slate-200">
                t={formatFrameTime(frame.timeSec)}
              </p>
              <span className="rounded-full border border-slate-700 bg-slate-950/80 px-2 py-0.5 text-[0.55rem] uppercase tracking-[0.2em] text-slate-200">
                Click to select
              </span>
            </div>
          </button>
          );
        })}
      </div>
      {hasMore ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300 transition hover:text-slate-100"
        >
          Show all frames
        </button>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-5xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-white">All frames</h3>
                <p className="mt-1 text-sm text-slate-400">
                  Click any frame to continue selection.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-slate-700 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-200 transition hover:border-slate-500"
              >
                Close
              </button>
            </div>
            <div className="mt-4 max-h-[70vh] overflow-y-auto pr-2">
              <div className={gridClassName}>
                {frames.map((frame, index) => {
                  const hasError = Boolean(imageErrors?.[frame.key]);
                  return (
                  <button
                    key={`${frame.key}-modal-${index}`}
                    type="button"
                    onClick={() => {
                      onSelectFrame(frame);
                      setOpen(false);
                    }}
                    className={`group relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-left transition ${
                      accentClasses[accent]
                    }`}
                  >
                    {hasError ? (
                      <div className="flex h-28 w-full items-center justify-center bg-slate-900 text-xs text-slate-400">
                        Image blocked
                      </div>
                    ) : (
                      <img
                        src={getFrameSrc(frame)}
                        alt={formatFrameAlt(frame.timeSec)}
                        className="h-28 w-full object-cover"
                        loading="lazy"
                        decoding="async"
                        onLoad={() => onImageLoad?.(frame)}
                        onError={() => onImageError?.(frame)}
                      />
                    )}
                    <div className="absolute inset-0 bg-slate-950/40 opacity-0 transition group-hover:opacity-100" />
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent px-3 py-2">
                      <p className="text-[0.6rem] uppercase tracking-[0.2em] text-slate-200">
                        t={formatFrameTime(frame.timeSec)}
                      </p>
                      <span className="rounded-full border border-slate-700 bg-slate-950/80 px-2 py-0.5 text-[0.55rem] uppercase tracking-[0.2em] text-slate-200">
                        Click to select
                      </span>
                    </div>
                  </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
