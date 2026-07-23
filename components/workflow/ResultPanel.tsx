import type { AnalysisJob } from "@/lib/workflow-api";

const formatScore = (value: number | null, scale = 100) => {
  if (value === null) return "—";
  return `${value.toFixed(1)}${scale === 100 ? "" : ` / ${scale}`}`;
};

export function ResultPanel({ job, preliminary = false }: { job: AnalysisJob; preliminary?: boolean }) {
  const result = job.result;
  if (!result) {
    return (
      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="text-lg font-semibold text-white">Risultato non ancora disponibile</h2>
        <p className="mt-2 text-sm text-slate-400">
          Il job è terminato senza un payload di valutazione leggibile. Consulta gli avvisi o riprova l’analisi.
        </p>
      </section>
    );
  }

  const primaryScore = result.matchRating10 ?? result.overallScore ?? result.roleScore;
  const primaryScale = result.matchRating10 !== null ? 10 : 100;
  const radarEntries = Object.entries(result.radar);

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
              {preliminary ? "Valutazione preliminare" : "Analisi completata"}
            </p>
            <h2 className="mt-2 text-2xl font-bold text-white">
              {job.role ?? "Giocatore"} · {job.category ?? "categoria non indicata"}
            </h2>
            {result.explanation ? (
              <p className="mt-3 max-w-3xl text-sm leading-6 text-emerald-50/80">
                {result.explanation}
              </p>
            ) : null}
          </div>
          <div className="min-w-36 rounded-2xl bg-slate-950/80 px-5 py-4 text-center">
            <p className="text-4xl font-black text-white">
              {formatScore(primaryScore, primaryScale)}
            </p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              punteggio
            </p>
          </div>
        </div>
      </div>

      {radarEntries.length > 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
          <h3 className="text-lg font-semibold text-white">Indicatori</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {radarEntries.map(([label, value]) => {
              const normalized = Math.max(0, Math.min(100, value));
              return (
                <div key={label} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium capitalize text-slate-200">
                      {label.replaceAll("_", " ")}
                    </span>
                    <span className="text-sm font-bold text-white">{value.toFixed(1)}</span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${normalized}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
          <h3 className="text-lg font-semibold text-white">Dettaglio punteggi</h3>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4 border-b border-slate-800 pb-3">
              <dt className="text-slate-400">Match rating</dt>
              <dd className="font-semibold text-slate-100">{formatScore(result.matchRating10, 10)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-slate-800 pb-3">
              <dt className="text-slate-400">Impact 100</dt>
              <dd className="font-semibold text-slate-100">{formatScore(result.impact100)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-slate-800 pb-3">
              <dt className="text-slate-400">Overall score</dt>
              <dd className="font-semibold text-slate-100">{formatScore(result.overallScore)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-400">Role score</dt>
              <dd className="font-semibold text-slate-100">{formatScore(result.roleScore)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
          <h3 className="text-lg font-semibold text-white">Clip</h3>
          {job.clips.length === 0 ? (
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Nessuna clip generata per questo job.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {job.clips.map((clip, index) => (
                <li key={`${clip.url}-${index}`}>
                  <a
                    href={clip.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-200 transition hover:border-emerald-500/50 hover:text-white"
                  >
                    <span>{clip.label}</span>
                    <span aria-hidden="true">↗</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
