"use client";

import { useState, type ReactNode } from "react";

type DebugPanelProps = {
  title?: string;
  children: ReactNode;
};

export default function DebugPanel({
  title = "Show technical details",
  children
}: DebugPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-[0.2em] text-slate-300"
      >
        <span>{title}</span>
        <span className="text-[0.65rem] text-slate-500">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open ? <div className="mt-4 space-y-3 text-xs text-slate-300">{children}</div> : null}
    </div>
  );
}
