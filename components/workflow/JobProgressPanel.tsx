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

const metric = (value: number | null) => (value === null ? "—" : String(Math.round(value)));

export function JobProgressPanel({ job }: { job: AnalysisJob }) {
  const pct = Math.max(0, Math.min(100, job.progress.pct));
  const statusLabel = STATUS_LABELS[job.status] ?? job.status;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
            {statusLabel}
          </p>
          <h2 className="mt-2 text-lg font-semibold text-white">
            {job.progress.message ?? "Elaborazione del job"}
          </h2>
          <p className="mt-1 break-all font-mono text-xs text-slate-500">{job.id}</p>
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
          className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
          <dt className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Frame usati</dt>
          <dd className="mt-1 text-lg font-semibold text-slate-100">
            {metric(job.progress.stats.framesUsed ?? job.framesProcessed)}
          </dd>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
          <dt className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Frame totali</dt>
          <dd className="mt-1 text-lg font-semibold text-slate-100">
            {metric(job.progress.stats.framesTotal)}
          </dd>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
          <dt className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Rilevamenti</dt>
          <dd className="mt-1 text-lg font-semibold text-slate-100">
            {metric(job.progress.stats.detections)}
          </dd>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
          <dt className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Tracklet</dt>
          <dd className="mt-1 text-lg font-semibold text-slate-100">
            {metric(job.progress.stats.tracklets)}
          </dd>
        </div>
      </dl>

      {job.warnings.length > 0 ? (
        <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
            Avvisi
          </p>
          <ul className="mt-2 space-y-1 text-sm text-amber-100">
            {job.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
