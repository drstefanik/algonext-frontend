"use client";

import { useEffect, useState } from "react";

import type { AnalysisJob } from "@/lib/workflow-api";

const STATUS_LABELS: Record<string, string> = {
  CREATED: "Job creato",
  WAITING_FOR_SELECTION: "Preparazione frame",
  EXTRACTING_PREVIEWS: "Estrazione frame",
  PREVIEWS_READY: "Frame pronti",
  TRACKING_CANDIDATES: "Rilevamento giocatori",
  WAITING_FOR_PLAYER: "Seleziona giocatore",
  WAITING_FOR_TARGET: "Conferma target",
  READY_TO_ENQUEUE: "Pronto per l’analisi",
  QUEUED: "In coda",
  RUNNING: "Analisi in corso",
  PROCESSING: "Analisi in corso",
  COMPLETED: "Completato",
  PARTIAL: "Completato con dati parziali",
  FAILED: "Errore"
};

const WARNING_LABELS: Record<string, string> = {
  TRACKING_TIMEOUT: "Il tracking ha superato il limite operativo.",
  TRACKING_PARTIAL_TIMEOUT:
    "Il budget di tracking è terminato: il job continua con dati parziali e senza voto.",
  RETRY_ENQUEUE_FAILED: "Il nuovo tentativo non è entrato nella coda del worker.",
  WORKER_RESTARTED:
    "Il worker è stato riavviato durante l’analisi. Il job può essere ripreso senza rifare la selezione.",
  TRACKING_EVIDENCE_INSUFFICIENT:
    "L’evidenza di tracking è insufficiente per una valutazione attendibile.",
  CROSS_SHOT_IDENTITY_UNVALIDATED:
    "L’identità del giocatore non è verificata tra cambi camera, replay e occlusioni.",
  LONG_TRACKING_GAPS:
    "Sono presenti lunghe interruzioni nel tracking del giocatore.",
  PLAYER_EVALUATION_WITHHELD:
    "La valutazione del giocatore è sospesa per evitare un punteggio non validato.",
  LOW_TRACKING_COVERAGE:
    "Il giocatore è stato seguito in una porzione troppo ridotta della partita.",
  LOW_TRACKLET_CONTINUITY:
    "Le tracce disponibili non sono abbastanza continue.",
  CONTINUITY_NOT_MEASURED:
    "La continuità del tracking non è stata misurata.",
  INSUFFICIENT_TRACKING_SAMPLES:
    "I campioni osservati non sono sufficienti per una conclusione affidabile.",
  MISSING_CLIPS: "Una o più clip previste non sono disponibili."
};

const PRE_RESULT_WARNING_CODES = new Set([
  "TRACKING_TIMEOUT",
  "TRACKING_PARTIAL_TIMEOUT",
  "RETRY_ENQUEUE_FAILED",
  "WORKER_RESTARTED"
]);

const PRE_RESULT_WARNING_MESSAGES = new Set(
  [...PRE_RESULT_WARNING_CODES]
    .map((code) => WARNING_LABELS[code])
    .filter((message): message is string => Boolean(message))
);

const metric = (value: number | null) =>
  value === null ? "—" : String(Math.round(value));

const relativeUpdate = (value: string | null, now: number | null) => {
  if (!value) return { label: "—", stale: false };
  if (now === null) return { label: "in attesa", stale: false };
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return { label: "—", stale: false };
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 15) return { label: "adesso", stale: false };
  if (seconds < 60) return { label: `${seconds} s fa`, stale: false };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { label: `${minutes} min fa`, stale: minutes >= 3 };
  const hours = Math.floor(minutes / 60);
  return { label: `${hours} h fa`, stale: true };
};

const parseWindowProgress = (message: string | null) => {
  if (!message) return null;
  const exact = message.match(/(\d+)\s*\/\s*(\d+)\s*finestre/i);
  if (exact) {
    return {
      completed: Number(exact[1]),
      total: Number(exact[2]),
      label: `${exact[1]} / ${exact[2]}`
    };
  }
  const percent = message.match(/(\d{1,3})%\s*finestre/i);
  return percent
    ? { completed: null, total: null, label: `${percent[1]}%` }
    : null;
};

const isOperationalWarning = (warning: string) =>
  PRE_RESULT_WARNING_CODES.has(warning) || PRE_RESULT_WARNING_MESSAGES.has(warning);

export function JobProgressPanel({ job }: { job: AnalysisJob }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const interval = window.setInterval(update, 15_000);
    return () => window.clearInterval(interval);
  }, []);

  const pct = Math.max(0, Math.min(100, job.progress.pct));
  const statusLabel = STATUS_LABELS[job.status] ?? job.status;
  const isFailed = job.status === "FAILED";
  const isActive = ["QUEUED", "RUNNING", "PROCESSING"].includes(job.status);
  const isTerminal = ["COMPLETED", "PARTIAL", "FAILED"].includes(job.status);
  const visibleWarnings = isTerminal
    ? job.warnings
    : job.warnings.filter(isOperationalWarning);
  const trackingPhase =
    job.progress.phase === "TRACKING" ||
    Boolean(job.progress.step?.toUpperCase().includes("TRACK"));
  const windowProgress = parseWindowProgress(job.progress.message);
  const heartbeat = relativeUpdate(job.progress.updatedAt ?? job.updatedAt, now);
  const stale = isActive && heartbeat.stale;

  return (
    <section
      className={`rounded-2xl border p-5 ${
        isFailed
          ? "border-rose-500/30 bg-rose-950/20"
          : stale
            ? "border-amber-500/30 bg-amber-950/10"
            : "border-slate-800 bg-slate-900/50"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p
            className={`text-xs font-semibold uppercase tracking-[0.2em] ${
              isFailed
                ? "text-rose-300"
                : stale
                  ? "text-amber-300"
                  : "text-emerald-400"
            }`}
          >
            {statusLabel}
          </p>
          <h2 className="mt-2 text-lg font-semibold text-white">
            {job.progress.message ?? "Elaborazione del job"}
          </h2>
          <p className="mt-1 break-all font-mono text-xs text-slate-500">{job.id}</p>
          {stale ? (
            <p className="mt-3 text-sm text-amber-200">
              Nessun heartbeat recente. Il polling continua, ma il worker potrebbe essere rallentato.
            </p>
          ) : null}
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-right">
          <p className="text-2xl font-bold text-white">{Math.round(pct)}%</p>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
            {job.progress.phase ?? job.progress.step ?? "workflow"}
          </p>
        </div>
      </div>

      <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            isFailed ? "bg-rose-500" : stale ? "bg-amber-400" : "bg-emerald-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
          <dt className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
            {trackingPhase ? "Finestre elaborate" : "Campioni preliminari"}
          </dt>
          <dd className="mt-1 text-lg font-semibold text-slate-100">
            {trackingPhase
              ? windowProgress?.label ?? "in corso"
              : metric(job.progress.stats.framesUsed ?? job.framesProcessed)}
          </dd>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
          <dt className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
            Ultimo heartbeat
          </dt>
          <dd className={`mt-1 text-lg font-semibold ${stale ? "text-amber-200" : "text-slate-100"}`}>
            {heartbeat.label}
          </dd>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
          <dt className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Rilevamenti</dt>
          <dd className="mt-1 text-lg font-semibold text-slate-100">{metric(job.progress.stats.detections)}</dd>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
          <dt className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Tracklet</dt>
          <dd className="mt-1 text-lg font-semibold text-slate-100">{metric(job.progress.stats.tracklets)}</dd>
        </div>
      </dl>

      {visibleWarnings.length > 0 ? (
        <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">Avvisi</p>
          <ul className="mt-2 space-y-1 text-sm text-amber-100">
            {visibleWarnings.map((warning) => (
              <li key={warning}>{WARNING_LABELS[warning] ?? warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
