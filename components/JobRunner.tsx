"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";

import { useAnalysisWorkflow, type WorkflowStage } from "@/hooks/useAnalysisWorkflow";
import { JobCreateForm } from "@/components/workflow/JobCreateForm";
import { JobProgressPanel } from "@/components/workflow/JobProgressPanel";
import { PlayerPicker } from "@/components/workflow/PlayerPicker";
import { ResultPanel } from "@/components/workflow/ResultPanel";

const STEPS: Array<{ key: WorkflowStage[]; label: string }> = [
  { key: ["create"], label: "Video" },
  { key: ["preparing", "select-player"], label: "Giocatore" },
  { key: ["ready"], label: "Conferma" },
  { key: ["analysis", "result", "failed"], label: "Analisi" }
];

const getActiveStep = (stage: WorkflowStage) => {
  const index = STEPS.findIndex((step) => step.key.includes(stage));
  return index === -1 ? 0 : index;
};

export default function JobRunner() {
  const workflow = useAnalysisWorkflow();
  const [resumeId, setResumeId] = useState("");
  const activeStep = useMemo(() => getActiveStep(workflow.stage), [workflow.stage]);

  const submitResume = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (resumeId.trim()) void workflow.resume(resumeId);
  };

  if (workflow.isBootstrapping) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-emerald-400" />
        <p className="mt-4 text-sm text-slate-400">Ripristino dell’ultimo job…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <nav aria-label="Avanzamento analisi" className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
        <ol className="grid grid-cols-4 gap-2">
          {STEPS.map((step, index) => {
            const complete = index < activeStep;
            const active = index === activeStep;
            return (
              <li key={step.label} className="min-w-0">
                <div
                  className={`h-1.5 rounded-full ${
                    complete || active ? "bg-emerald-500" : "bg-slate-800"
                  }`}
                />
                <p
                  className={`mt-2 truncate text-[10px] font-semibold uppercase tracking-[0.16em] sm:text-xs ${
                    active ? "text-emerald-300" : complete ? "text-slate-300" : "text-slate-600"
                  }`}
                >
                  {index + 1}. {step.label}
                </p>
              </li>
            );
          })}
        </ol>
      </nav>

      {workflow.job ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Job attivo
            </p>
            <p className="mt-1 truncate font-mono text-xs text-slate-300">{workflow.job.id}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void workflow.refresh()}
              disabled={workflow.isBusy}
              className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white disabled:opacity-40"
            >
              Aggiorna
            </button>
            <button
              type="button"
              onClick={workflow.reset}
              disabled={workflow.isBusy}
              className="rounded-lg border border-rose-500/30 px-3 py-2 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/10 disabled:opacity-40"
            >
              Nuovo job
            </button>
          </div>
        </div>
      ) : null}

      {workflow.error ? (
        <div role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
          <p className="font-semibold">Operazione non riuscita</p>
          <p className="mt-1 break-words leading-6 text-rose-200/90">{workflow.error}</p>
        </div>
      ) : null}

      {workflow.stage === "create" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 sm:p-6">
            <div className="mb-6">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">
                Nuova analisi
              </p>
              <h2 className="mt-2 text-2xl font-bold text-white">Carica una partita</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                Il flusso segue direttamente la macchina a stati del backend: crea il job,
                prepara i frame, conferma un giocatore e avvia l’analisi.
              </p>
            </div>
            <JobCreateForm busy={workflow.busyAction === "create"} onSubmit={workflow.start} />
          </section>

          <aside className="space-y-4">
            <form onSubmit={submitResume} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
              <h2 className="text-base font-semibold text-white">Riprendi un job</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                Incolla l’identificativo per riaprire un’elaborazione esistente.
              </p>
              <input
                value={resumeId}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setResumeId(event.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-slate-100 outline-none focus:border-emerald-400"
                disabled={workflow.busyAction === "resume"}
              />
              <button
                type="submit"
                disabled={!resumeId.trim() || workflow.busyAction === "resume"}
                className="mt-3 w-full rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-500 disabled:opacity-40"
              >
                {workflow.busyAction === "resume" ? "Apertura…" : "Apri job"}
              </button>
            </form>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5 text-sm leading-6 text-slate-400">
              <p className="font-semibold text-slate-200">Flusso resiliente</p>
              <p className="mt-2">
                Polling centralizzato, errori con request ID, heartbeat del worker e retry del
                medesimo job senza perdere video o selezione.
              </p>
            </div>
          </aside>
        </div>
      ) : null}

      {workflow.job && workflow.stage === "preparing" ? (
        <div className="space-y-5">
          <JobProgressPanel job={workflow.job} />
          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
            <h2 className="text-lg font-semibold text-white">Preparazione automatica</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Il worker sta estraendo i frame e rilevando le tracce. Non serve ricaricare la
              pagina; il polling riprenderà automaticamente anche dopo un errore temporaneo.
            </p>
            <div className="mt-5 flex items-center gap-3 text-sm text-slate-300">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />
              {workflow.frames.length > 0
                ? `${workflow.frames.length} frame ricevuti, attendo le tracce…`
                : "Attendo i primi frame…"}
            </div>
          </section>
        </div>
      ) : null}

      {workflow.job && workflow.stage === "select-player" ? (
        <div className="space-y-5">
          <JobProgressPanel job={workflow.job} />
          <PlayerPicker
            frames={workflow.frames}
            selection={workflow.selection}
            busy={workflow.busyAction === "select-player"}
            onSelect={workflow.setSelection}
            onConfirm={workflow.choosePlayer}
          />
        </div>
      ) : null}

      {workflow.job && workflow.stage === "ready" ? (
        <div className="space-y-5">
          <JobProgressPanel job={workflow.job} />
          <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
              Selezione salvata
            </p>
            <h2 className="mt-2 text-2xl font-bold text-white">Il job è pronto</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-emerald-50/80">
              Il riferimento giocatore e il target risultano confermati. Avvia ora il worker di
              analisi completa.
            </p>
            <button
              type="button"
              onClick={() => void workflow.enqueue()}
              disabled={workflow.busyAction === "enqueue"}
              className="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl bg-emerald-400 px-6 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-300 disabled:opacity-50"
            >
              {workflow.busyAction === "enqueue" ? "Avvio…" : "Avvia analisi completa"}
            </button>
          </section>
          {workflow.job.result ? <ResultPanel job={workflow.job} preliminary /> : null}
        </div>
      ) : null}

      {workflow.job && workflow.stage === "analysis" ? (
        <div className="space-y-5">
          <JobProgressPanel job={workflow.job} />
          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
            <h2 className="text-lg font-semibold text-white">Pipeline in esecuzione</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Il backend ora espone heartbeat e avanzamento delle finestre. I dati preliminari
              non vengono mostrati durante il run, per non confonderli con il risultato finale.
              Puoi chiudere la pagina e riaprire lo stesso job più tardi.
            </p>
          </section>
        </div>
      ) : null}

      {workflow.job && workflow.stage === "result" ? (
        <div className="space-y-5">
          <JobProgressPanel job={workflow.job} />
          <ResultPanel job={workflow.job} />
        </div>
      ) : null}

      {workflow.job && workflow.stage === "failed" ? (
        <div className="space-y-5">
          <JobProgressPanel job={workflow.job} />
          <section className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-300">
              Analisi interrotta
            </p>
            <h2 className="mt-2 text-xl font-bold text-white">
              {workflow.job.error ?? "Il worker non ha completato il job."}
            </h2>
            {workflow.job.failureReason ? (
              <p className="mt-2 text-sm leading-6 text-rose-100/80">
                Motivo: {workflow.job.failureReason}
              </p>
            ) : null}
            <p className="mt-3 max-w-3xl text-sm leading-6 text-rose-100/75">
              {workflow.job.playerSaved && workflow.job.targetSaved
                ? "Il video, i frame e la selezione del giocatore restano salvati. Il retry riusa lo stesso job e il nuovo profilo CPU, senza ripetere la scelta manuale."
                : "Il job non contiene ancora una selezione completa e non può essere riavviato in sicurezza. Crea un nuovo job dopo aver corretto la sorgente del video."}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              {workflow.job.playerSaved && workflow.job.targetSaved ? (
                <button
                  type="button"
                  onClick={() => void workflow.retry()}
                  disabled={workflow.busyAction === "retry"}
                  className="rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-slate-100 disabled:opacity-50"
                >
                  {workflow.busyAction === "retry" ? "Riavvio…" : "Riprova analisi"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={workflow.reset}
                disabled={workflow.isBusy}
                className="rounded-xl border border-rose-200/30 px-5 py-2.5 text-sm font-bold text-rose-100 transition hover:bg-rose-500/10 disabled:opacity-50"
              >
                Crea un nuovo job
              </button>
            </div>
          </section>
          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 text-sm leading-6 text-slate-400">
            La diagnostica preliminare non viene mostrata dopo un errore: non rappresenta il run
            completo e non deve essere interpretata come risultato del giocatore.
          </section>
        </div>
      ) : null}
    </div>
  );
}
