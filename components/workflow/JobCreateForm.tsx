"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

import {
  getLgiMatches,
  type CreateJobInput,
  type LgiMatchSummary
} from "@/lib/workflow-api";

const ROLES = [
  "Goalkeeper",
  "Centre Back",
  "Full Back",
  "Defensive Midfielder",
  "Midfielder",
  "Winger",
  "Forward"
];

const CATEGORIES = ["U13", "U14", "U15", "U16", "U17", "U18", "U19", "Senior"];

export function JobCreateForm({
  busy,
  onSubmit
}: {
  busy: boolean;
  onSubmit: (input: CreateJobInput) => Promise<void>;
}) {
  const [sourceMode, setSourceMode] = useState<"url" | "object" | "lgi">("lgi");
  const [source, setSource] = useState("");
  const [lgiQuery, setLgiQuery] = useState("");
  const [lgiMatches, setLgiMatches] = useState<LgiMatchSummary[]>([]);
  const [lgiLoading, setLgiLoading] = useState(false);
  const [lgiError, setLgiError] = useState<string | null>(null);
  const [bucket, setBucket] = useState("fnh");
  const [role, setRole] = useState("Midfielder");
  const [category, setCategory] = useState("U17");
  const [fullMatchMode, setFullMatchMode] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const selectedLgiMatch = useMemo(
    () => lgiMatches.find((match) => match.id === source) ?? null,
    [lgiMatches, source]
  );

  useEffect(() => {
    if (sourceMode !== "lgi") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLgiLoading(true);
      setLgiError(null);
      void getLgiMatches({
        query: lgiQuery.trim(),
        pilotOnly: !lgiQuery.trim(),
        limit: 50
      })
        .then((items) => {
          if (cancelled) return;
          setLgiMatches(items);
          setSource((current) =>
            items.some((item) => item.id === current) ? current : items[0]?.id ?? ""
          );
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setLgiMatches([]);
          setSource("");
          setLgiError(
            error instanceof Error
              ? error.message
              : "Catalogo LGI momentaneamente non disponibile."
          );
        })
        .finally(() => {
          if (!cancelled) setLgiLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sourceMode, lgiQuery]);

  useEffect(() => {
    if (!selectedLgiMatch?.competition) return;
    const inferredCategory = selectedLgiMatch.competition.match(/\bU(1[3-9])\b/i)?.[0];
    if (inferredCategory && CATEGORIES.includes(inferredCategory.toUpperCase())) {
      setCategory(inferredCategory.toUpperCase());
    }
  }, [selectedLgiMatch]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedSource = source.trim();
    if (!normalizedSource) {
      setValidationError(
        sourceMode === "lgi"
          ? "Seleziona una partita LGI Channel."
          : "Inserisci l’URL del video oppure la chiave dell’oggetto."
      );
      return;
    }
    if (sourceMode === "url" && !/^https?:\/\//i.test(normalizedSource)) {
      setValidationError("L’URL deve iniziare con http:// oppure https://.");
      return;
    }
    if (sourceMode === "object" && !bucket.trim()) {
      setValidationError("Indica il bucket che contiene il video.");
      return;
    }

    setValidationError(null);
    await onSubmit({
      source: normalizedSource,
      sourceMode,
      bucket: sourceMode === "object" ? bucket.trim() : undefined,
      role,
      category,
      // Il backend storico richiede ancora team_name alla creazione. Il valore
      // descrittivo reale viene associato solo dopo la selezione visiva.
      teamName: "Da associare",
      fullMatchMode
    });
  };

  const inputClass =
    "mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/10";
  const labelClass = "text-xs font-semibold uppercase tracking-[0.18em] text-slate-400";

  return (
    <form onSubmit={submit} className="space-y-6">
      <div>
        <p className={labelClass}>Origine video</p>
        <div className="mt-2 inline-flex rounded-xl border border-slate-800 bg-slate-950 p-1">
          {(
            [
              ["lgi", "LGI Channel"],
              ["url", "URL pubblico"],
              ["object", "MinIO / S3"]
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setSourceMode(value)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                sourceMode === value
                  ? "bg-emerald-500 text-slate-950"
                  : "text-slate-400 hover:text-slate-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {sourceMode === "lgi" ? (
        <div className="space-y-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className={labelClass}>Archivio LGI Channel</p>
              <p className="mt-1 text-sm text-slate-400">
                Connessione protetta in sola lettura. Le analisi vengono salvate esclusivamente
                su AlgoNext.
              </p>
            </div>
            <span className="w-fit rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">
              Sola lettura
            </span>
          </div>

          <label className="block">
            <span className={labelClass}>Cerca altre partite</span>
            <input
              value={lgiQuery}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setLgiQuery(event.target.value)}
              className={inputClass}
              placeholder="Squadra, competizione o titolo…"
              disabled={busy}
            />
          </label>

          <label className="block">
            <span className={labelClass}>
              {lgiQuery.trim() ? "Risultati archivio" : "Pilot selezionato"}
            </span>
            <select
              value={source}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => setSource(event.target.value)}
              className={inputClass}
              disabled={busy || lgiLoading || lgiMatches.length === 0}
            >
              {lgiLoading ? <option>Caricamento partite…</option> : null}
              {!lgiLoading && lgiMatches.length === 0 ? (
                <option value="">Nessuna partita disponibile</option>
              ) : null}
              {lgiMatches.map((match) => (
                <option key={match.id} value={match.id}>
                  {match.title} · {match.provider.toUpperCase()}
                </option>
              ))}
            </select>
          </label>

          {selectedLgiMatch ? (
            <div className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Partita
                </p>
                <p className="mt-1 text-slate-200">
                  {selectedLgiMatch.homeTeam} – {selectedLgiMatch.awayTeam}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Contesto
                </p>
                <p className="mt-1 text-slate-200">
                  {[selectedLgiMatch.competition, selectedLgiMatch.season]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  Distinta
                </p>
                <p className="mt-1 text-slate-200">
                  {selectedLgiMatch.lineupCount} giocatori · numeri completi
                </p>
              </div>
            </div>
          ) : null}

          {lgiError ? (
            <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {lgiError}
            </p>
          ) : null}
        </div>
      ) : (
      <div className="grid gap-5 lg:grid-cols-2">
        <label>
          <span className={labelClass}>
            {sourceMode === "url" ? "URL del video" : "Chiave oggetto"}
          </span>
          <input
            value={source}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setSource(event.target.value)}
            className={inputClass}
            placeholder={
              sourceMode === "url"
                ? "https://…/partita.mp4"
                : "uploads/partita-2026.mp4"
            }
            disabled={busy}
          />
        </label>
        {sourceMode === "object" ? (
          <label>
            <span className={labelClass}>Bucket</span>
            <input
              value={bucket}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setBucket(event.target.value)}
              className={inputClass}
              placeholder="fnh"
              disabled={busy}
            />
          </label>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-400">
            Il backend scarica il file una sola volta e avvia automaticamente l’estrazione dei frame.
          </div>
        )}
      </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
        <p className={labelClass}>Contesto dell’analisi</p>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Ruolo e categoria servono a contestualizzare il report. Nome, squadra e numero di
          maglia verranno associati al giocatore soltanto dopo che avrai cliccato il riquadro
          corretto nel passaggio successivo.
        </p>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <label>
            <span className={labelClass}>Ruolo del giocatore</span>
            <select
              value={role}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => setRole(event.target.value)}
              className={inputClass}
              disabled={busy}
            >
              {ROLES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelClass}>Categoria</span>
            <select
              value={category}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => setCategory(event.target.value)}
              className={inputClass}
              disabled={busy}
            >
              {CATEGORIES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
        <input
          type="checkbox"
          checked={fullMatchMode}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setFullMatchMode(event.target.checked)}
          className="mt-1 h-4 w-4 accent-emerald-500"
          disabled={busy}
        />
        <span>
          <span className="block text-sm font-semibold text-slate-100">Analisi partita completa</span>
          <span className="mt-1 block text-xs leading-5 text-slate-500">
            Campiona l’intero video. Disattivala solo per test molto brevi.
          </span>
        </span>
      </label>

      {validationError ? (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {validationError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-500 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      >
        {busy ? "Creazione in corso…" : "Crea job e rileva i giocatori"}
      </button>
    </form>
  );
}
