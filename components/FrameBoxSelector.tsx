"use client";

import { useMemo, useRef, useState, type MouseEvent } from "react";
import type { FrameSelection, JobFrame } from "@/lib/api";

type DragState = {
  frameIndex: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type FrameBoxSelectorProps = {
  frames: JobFrame[];
  selections: FrameSelection[];
  onSelectionsChange: (next: FrameSelection[]) => void;
  maxSelections?: number;
};

const DEFAULT_MAX_SELECTIONS = 5;

export default function FrameBoxSelector({
  frames,
  selections,
  onSelectionsChange,
  maxSelections = DEFAULT_MAX_SELECTIONS
}: FrameBoxSelectorProps) {
  const imageRefs = useRef<Record<number, HTMLImageElement | null>>({});
  const [dragState, setDragState] = useState<DragState | null>(null);

  const selectionsByFrame = useMemo(() => {
    return selections.reduce<Record<number, FrameSelection[]>>((acc, selection) => {
      const frameIndex = frames.findIndex((frame) => frame.t === selection.t);
      if (frameIndex >= 0) {
        acc[frameIndex] = acc[frameIndex] ?? [];
        acc[frameIndex].push(selection);
      }
      return acc;
    }, {});
  }, [frames, selections]);

  const handleMouseDown = (
    frameIndex: number,
    event: MouseEvent<HTMLDivElement>
  ) => {
    if (selections.length >= maxSelections) {
      return;
    }
    const image = imageRefs.current[frameIndex];
    if (!image) {
      return;
    }
    const rect = image.getBoundingClientRect();
    const startX = event.clientX - rect.left;
    const startY = event.clientY - rect.top;

    setDragState({
      frameIndex,
      startX,
      startY,
      currentX: startX,
      currentY: startY
    });
  };

  const handleMouseMove = (
    frameIndex: number,
    event: MouseEvent<HTMLDivElement>
  ) => {
    if (!dragState || dragState.frameIndex !== frameIndex) {
      return;
    }
    const image = imageRefs.current[frameIndex];
    if (!image) {
      return;
    }
    const rect = image.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;
    setDragState((prev) =>
      prev
        ? {
            ...prev,
            currentX,
            currentY
          }
        : prev
    );
  };

  const handleMouseUp = (frameIndex: number) => {
    if (!dragState || dragState.frameIndex !== frameIndex) {
      return;
    }
    const image = imageRefs.current[frameIndex];
    const frame = frames[frameIndex];
    if (!image || !frame) {
      setDragState(null);
      return;
    }
    const { startX, startY, currentX, currentY } = dragState;
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    if (width > 1 && height > 1) {
      const normalized: FrameSelection = {
        t: frame.t,
        x: left / image.clientWidth,
        y: top / image.clientHeight,
        w: width / image.clientWidth,
        h: height / image.clientHeight
      };
      onSelectionsChange([...selections, normalized]);
    }
    setDragState(null);
  };

  const handleRemoveSelection = (index: number) => {
    const next = selections.filter((_, selectionIndex) => selectionIndex !== index);
    onSelectionsChange(next);
  };

  const activeRect =
    dragState && frames[dragState.frameIndex]
      ? {
          frameIndex: dragState.frameIndex,
          left: Math.min(dragState.startX, dragState.currentX),
          top: Math.min(dragState.startY, dragState.currentY),
          width: Math.abs(dragState.currentX - dragState.startX),
          height: Math.abs(dragState.currentY - dragState.startY)
        }
      : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>
          Draw 2–5 bounding boxes across the frames below.
        </span>
        <span>
          {selections.length}/{maxSelections} selected
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {frames.map((frame, frameIndex) => (
          <div
            key={`${frame.t}-${frameIndex}`}
            className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-950"
            onMouseDown={(event) => handleMouseDown(frameIndex, event)}
            onMouseMove={(event) => handleMouseMove(frameIndex, event)}
            onMouseUp={() => handleMouseUp(frameIndex)}
            onMouseLeave={() => handleMouseUp(frameIndex)}
          >
            <img
              ref={(node) => {
                imageRefs.current[frameIndex] = node;
              }}
              src={frame.url}
              alt={`Frame at ${frame.t.toFixed(2)}s`}
              className="h-auto w-full select-none"
              draggable={false}
            />
            <div className="pointer-events-none absolute inset-0">
              {(selectionsByFrame[frameIndex] ?? []).map((selection, index) => (
                <div
                  key={`${selection.t}-${index}`}
                  className="absolute rounded border border-emerald-400 bg-emerald-400/20"
                  style={{
                    left: `${selection.x * 100}%`,
                    top: `${selection.y * 100}%`,
                    width: `${selection.w * 100}%`,
                    height: `${selection.h * 100}%`
                  }}
                />
              ))}
              {activeRect && activeRect.frameIndex === frameIndex ? (
                <div
                  className="absolute rounded border border-blue-400 bg-blue-400/20"
                  style={{
                    left: activeRect.left,
                    top: activeRect.top,
                    width: activeRect.width,
                    height: activeRect.height
                  }}
                />
              ) : null}
            </div>
            <div className="absolute bottom-2 right-2 rounded-full bg-slate-900/80 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-300">
              t={frame.t.toFixed(2)}s
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
          Selected Boxes
        </p>
        {selections.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">
            No boxes selected yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm text-slate-200">
            {selections.map((selection, index) => (
              <li
                key={`${selection.t}-${index}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2"
              >
                <span>
                  Frame {selection.t.toFixed(2)}s — x:{selection.x.toFixed(2)} y:
                  {selection.y.toFixed(2)} w:{selection.w.toFixed(2)} h:
                  {selection.h.toFixed(2)}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveSelection(index)}
                  className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 transition hover:border-slate-500"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
