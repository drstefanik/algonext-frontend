"use client";

import { ChangeEvent, FormEvent, useState } from "react";

import type { CreateJobInput } from "@/lib/workflow-api";

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
  const [sourceMode, setSourceMode] = useState<"url" | "object">("url");
  const [source, setSource] = useState("");
  const [bucket, setBucket] = useState("fnh");
  const [role, setRole] = useState("Midfielder");
  const [category, setCategory] = useState("U17");
  const [teamName, setTeamName] = useState("");
  const [shirtNumber, setShirtNumber] = useState("");
  const [fullMatchMode, setFullMatchMode] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedSource = source.trim();
    const normalizedTeam = teamName.trim();
    if (!normalizedSource) {
      setValidationError("Inserisci l’URL del video oppure la chiave dell’oggetto.");
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
    if (!normalizedTeam) {
      setValidationError("Il nome della squadra è necessario per creare il job.");
      return;
    }

    const parsedShirtNumber = shirtNumber.trim() ? Number(shirtNumber) : undefined;
    if (
      parsedShirtNumber !== undefined &&
      (!Number.isInteger(parsedShirtNumber) || parsedShirtNumber < 0 || parsedShirtNumber > 99)
    ) {
      setValidationError("Il numero di maglia deve essere un intero tra 0 e 99.");
      return;
    }

    setValidationError(null);
    await onSubmit({
      source: normalizedSource,
      sourceMode,
      bucket: sourceMode === "object" ? bucket.trim() : undefined,
      role,
      category,
      teamName: normalizedTeam,
      shirtNumber: parsedShirtNumber,
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

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <label>
          <span className={labelClass}>Ruolo</span>
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
        <label>
          <span className={labelClass}>Squadra</span>
          <input
            value={teamName}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setTeamName(event.target.value)}
            className={inputClass}
            placeholder="AS Roma"
            disabled={busy}
          />
        </label>
        <label>
          <span className={labelClass}>Numero maglia</span>
          <input
            value={shirtNumber}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setShirtNumber(event.target.value)}
            className={inputClass}
            type="number"
            min={0}
            max={99}
            placeholder="8"
            disabled={busy}
          />
        </label>
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
        {busy ? "Creazione in corso…" : "Crea job e prepara i frame"}
      </button>
    </form>
  );
}
