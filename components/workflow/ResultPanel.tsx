import type { AnalysisJob, JobClip, JsonRecord } from "@/lib/workflow-api";

const formatScore = (value: number | null, scale = 100) => {
  if (value === null) return "—";
  return `${value.toFixed(1)}${scale === 100 ? "" : ` / ${scale}`}`;
};

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const asRecord = (value: unknown): JsonRecord => (isRecord(value) ? value : {});

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];

const humanize = (value: string) =>
  value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());

const SIGNALS = [
  { key: "coverage_pct", label: "Copertura tracking", suffix: "%", progress: true },
  {
    key: "tracklet_continuity_pct",
    label: "Continuità tracklet",
    suffix: "%",
    progress: true
  },
  {
    key: "sample_sufficiency_pct",
    label: "Sufficienza campioni",
    suffix: "%",
    progress: true
  },
  {
    key: "segments_with_player_pct",
    label: "Finestre con giocatore",
    suffix: "%",
    progress: true
  },
  { key: "samples_used", label: "Campioni osservati", suffix: "", progress: false },
  { key: "largest_gap_sec", label: "Interruzione massima", suffix: " s", progress: false }
] as const;

const CAPABILITY_LABELS: Record<string, string> = {
  person_detection: "Rilevamento persone",
  short_term_tracking: "Tracking a breve termine",
  cross_shot_player_reidentification: "Re-identificazione tra inquadrature",
  camera_motion_compensation: "Compensazione movimento camera",
  pitch_calibration: "Calibrazione del campo",
  ball_tracking: "Tracking della palla",
  event_detection: "Riconoscimento eventi",
  athletic_metrics: "Metriche atletiche reali",
  technical_tactical_scoring: "Valutazione tecnico-tattica"
};

function ClipsPanel({ clips }: { clips: JobClip[] }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
      <h3 className="text-lg font-semibold text-white">Clip</h3>
      {clips.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Nessuna clip generata per questo job.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {clips.map((clip, index) => (
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
  );
}

function TrackingOnlyPanel({ job, preliminary }: { job: AnalysisJob; preliminary: boolean }) {
  const result = job.result!;
  const raw = result.raw;
  const trackingQuality = asRecord(raw.tracking_quality);
  const summary = asRecord(raw.summary);
  const signals = asRecord(raw.tracking_signals ?? trackingQuality.signals);
  const capabilities = asRecord(raw.capabilities ?? trackingQuality.capabilities);
  const trackingQualityIndex =
    asNumber(raw.tracking_quality_index) ??
    asNumber(summary.tracking_quality_index) ??
    asNumber(trackingQuality.tracking_quality_index);
  const confidence =
    asString(trackingQuality.tracking_confidence) ?? asString(raw.tracking_confidence) ?? "low";
  const limitations = [
    ...asStringArray(raw.limitations),
    ...asStringArray(trackingQuality.limitations)
  ].filter((value, index, values) => values.indexOf(value) === index);
  const reasonCodes = [
    ...asStringArray(raw.reason_codes),
    ...asStringArray(trackingQuality.reason_codes)
  ].filter((value, index, values) => values.indexOf(value) === index);
  const capabilityEntries = Object.entries(capabilities).filter(
    (entry): entry is [string, boolean] => typeof entry[1] === "boolean"
  );
  const signalEntries = SIGNALS.map((definition) => ({
    ...definition,
    value: asNumber(signals[definition.key])
  })).filter((entry) => entry.value !== null);

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-sky-500/30 bg-sky-500/10 p-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-300">
              {preliminary ? "Diagnostica preliminare" : "Diagnostica computer vision"}
            </p>
            <h2 className="mt-2 text-2xl font-bold text-white">
              {job.role ?? "Giocatore"} · {job.category ?? "categoria non indicata"}
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-sky-50/80">
              {result.explanation ??
                "Il sistema misura la qualità dell’evidenza di tracking. Non sta ancora assegnando un voto calcistico al giocatore."}
            </p>
          </div>
          <div className="min-w-44 rounded-2xl bg-slate-950/80 px-5 py-4 text-center">
            <p className="text-4xl font-black text-white">
              {trackingQualityIndex === null ? "—" : trackingQualityIndex.toFixed(1)}
            </p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              indice tracking · non voto
            </p>
            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.15em] text-sky-300">
              confidenza {humanize(confidence)}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300">
          Valutazione del giocatore sospesa
        </p>
        <h3 className="mt-2 text-xl font-bold text-white">
          Nessun match rating o punteggio tecnico-tattico attendibile
        </h3>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-amber-50/80">
          Servono re-identificazione del giocatore tra cambi camera, calibrazione del campo,
          tracking della palla, riconoscimento degli eventi e validazione contro osservatori.
          I vecchi punteggi euristici non vengono più mostrati.
        </p>
      </div>

      {signalEntries.length > 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
          <h3 className="text-lg font-semibold text-white">Qualità dell’evidenza</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {signalEntries.map((entry) => {
              const value = entry.value!;
              const normalized = Math.max(0, Math.min(100, value));
              return (
                <div key={entry.key} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-slate-200">{entry.label}</span>
                    <span className="text-sm font-bold text-white">
                      {value.toFixed(entry.progress ? 1 : 0)}{entry.suffix}
                    </span>
                  </div>
                  {entry.progress ? (
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-sky-400"
                        style={{ width: `${normalized}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {capabilityEntries.length > 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
          <h3 className="text-lg font-semibold text-white">Capacità effettive</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {capabilityEntries.map(([key, available]) => (
              <div
                key={key}
                className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3"
              >
                <span className="text-sm text-slate-300">{CAPABILITY_LABELS[key] ?? humanize(key)}</span>
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
                    available
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-slate-800 text-slate-500"
                  }`}
                >
                  {available ? "Disponibile" : "Non disponibile"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
          <h3 className="text-lg font-semibold text-white">Limiti dichiarati</h3>
          {limitations.length > 0 ? (
            <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-400">
              {limitations.map((limitation) => (
                <li key={limitation} className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3">
                  {limitation}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Il backend non ha ancora restituito il dettaglio dei limiti.
            </p>
          )}
          {reasonCodes.length > 0 ? (
            <p className="mt-4 break-words font-mono text-[10px] leading-5 text-slate-600">
              {reasonCodes.join(" · ")}
            </p>
          ) : null}
        </div>
        <ClipsPanel clips={job.clips} />
      </div>
    </section>
  );
}

function ValidatedPlayerEvaluationPanel({ job, preliminary }: { job: AnalysisJob; preliminary: boolean }) {
  const result = job.result!;
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
              punteggio validato
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
        <ClipsPanel clips={job.clips} />
      </div>
    </section>
  );
}

export function ResultPanel({ job, preliminary = false }: { job: AnalysisJob; preliminary?: boolean }) {
  const result = job.result;
  if (!result) {
    return (
      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="text-lg font-semibold text-white">Risultato non ancora disponibile</h2>
        <p className="mt-2 text-sm text-slate-400">
          Il job è terminato senza un payload di analisi leggibile. Consulta gli avvisi o riprova.
        </p>
      </section>
    );
  }

  const provenance = asRecord(result.raw.score_provenance);
  const validatedPlayerEvaluation =
    result.raw.player_evaluation_available === true &&
    provenance.kind === "player_evaluation" &&
    provenance.validated_player_score === true;

  return validatedPlayerEvaluation ? (
    <ValidatedPlayerEvaluationPanel job={job} preliminary={preliminary} />
  ) : (
    <TrackingOnlyPanel job={job} preliminary={preliminary} />
  );
}
