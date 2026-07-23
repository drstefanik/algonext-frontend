"use client";

import type { PlayerSelection } from "@/hooks/useAnalysisWorkflow";
import type { PreviewFrame, PreviewTrack } from "@/lib/workflow-api";

const formatTime = (seconds: number | null) => {
  if (seconds === null) return "—";
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
};

const isSameSelection = (
  current: PlayerSelection | null,
  frame: PreviewFrame,
  track: PreviewTrack
) => current?.frame.key === frame.key && current.track.trackId === track.trackId;

export function PlayerPicker({
  frames,
  selection,
  busy,
  onSelect,
  onConfirm
}: {
  frames: PreviewFrame[];
  selection: PlayerSelection | null;
  busy: boolean;
  onSelect: (selection: PlayerSelection) => void;
  onConfirm: (selection: PlayerSelection) => Promise<void>;
}) {
  const selectableFrames = frames
    .filter((frame) => frame.tracks.length > 0)
    .sort((left, right) => right.tracks.length - left.tracks.length);

  if (selectableFrames.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <p className="text-sm font-semibold text-slate-100">Rilevamento giocatori in corso</p>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          I frame sono disponibili, ma il backend non ha ancora associato le tracce. La pagina si aggiorna automaticamente.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Seleziona il giocatore</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
              Clicca il riquadro corretto. Alla conferma salviamo sia il riferimento del giocatore sia il target, eliminando il vecchio doppio passaggio incoerente.
            </p>
          </div>
          <span className="rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-300">
            {selectableFrames.length} frame utili
          </span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {selectableFrames.map((frame) => (
          <article
            key={frame.key}
            className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950"
          >
            <div className="relative aspect-video bg-slate-900">
              {/* Signed S3 URLs are dynamic and expire, so they intentionally use img. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={frame.url}
                alt={`Frame a ${formatTime(frame.timeSec)}`}
                className="h-full w-full object-contain"
                loading="lazy"
              />
              {frame.tracks.map((track) => {
                const selected = isSameSelection(selection, frame, track);
                return (
                  <button
                    key={`${frame.key}-${track.trackId}`}
                    type="button"
                    aria-label={`Seleziona traccia ${track.trackId}`}
                    aria-pressed={selected}
                    onClick={() => onSelect({ frame, track })}
                    disabled={busy}
                    className={`absolute border-2 transition focus:outline-none focus:ring-2 focus:ring-white ${
                      selected
                        ? "z-20 border-amber-300 bg-amber-300/20 shadow-[0_0_0_2px_rgba(15,23,42,0.8)]"
                        : "z-10 border-emerald-300/80 bg-emerald-300/10 hover:border-white hover:bg-white/15"
                    }`}
                    style={{
                      left: `${track.bbox.x * 100}%`,
                      top: `${track.bbox.y * 100}%`,
                      width: `${track.bbox.w * 100}%`,
                      height: `${track.bbox.h * 100}%`
                    }}
                  >
                    <span className="absolute -top-5 left-0 rounded bg-slate-950/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      #{track.trackId}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3 text-xs text-slate-400">
              <span>{formatTime(frame.timeSec)}</span>
              <span>{frame.tracks.length} tracce</span>
            </div>
          </article>
        ))}
      </div>

      <div className="sticky bottom-4 z-30 rounded-2xl border border-slate-700 bg-slate-950/95 p-4 shadow-2xl shadow-black/40 backdrop-blur">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-semibold text-white">
              {selection
                ? `Traccia #${selection.track.trackId} selezionata`
                : "Nessun giocatore selezionato"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {selection
                ? `Frame ${formatTime(selection.frame.timeSec)} · ${selection.track.tier ?? "tier non indicato"}`
                : "Scegli un riquadro per continuare."}
            </p>
          </div>
          <button
            type="button"
            disabled={!selection || busy}
            onClick={() => selection && void onConfirm(selection)}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Salvataggio…" : "Conferma giocatore"}
          </button>
        </div>
      </div>
    </div>
  );
}
