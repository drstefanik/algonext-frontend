import type { ReactNode } from "react";

type WizardStep = {
  label: string;
};

type WizardShellProps = {
  title: string;
  description?: string;
  steps: WizardStep[];
  currentStep: number;
  sidebar: ReactNode;
  children: ReactNode;
};

export default function WizardShell({
  title,
  description,
  steps,
  currentStep,
  sidebar,
  children
}: WizardShellProps) {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold text-white sm:text-3xl">
          {title}
        </h2>
        {description ? (
          <p className="max-w-2xl text-sm text-slate-400 sm:text-base">
            {description}
          </p>
        ) : null}
      </header>

      <ol className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/70 px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-400">
        {steps.map((step, index) => {
          const stepIndex = index + 1;
          const isActive = stepIndex === currentStep;
          const isComplete = stepIndex < currentStep;
          return (
            <li key={step.label} className="flex items-center gap-2">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full border text-[0.65rem] font-semibold ${
                  isActive
                    ? "border-blue-400 bg-blue-500/20 text-blue-100"
                    : isComplete
                      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                      : "border-slate-700 text-slate-400"
                }`}
              >
                {stepIndex}
              </span>
              <span
                className={
                  isActive ? "text-slate-100" : isComplete ? "text-emerald-200" : ""
                }
              >
                {step.label}
              </span>
              {index < steps.length - 1 ? (
                <span className="mx-1 hidden text-slate-600 sm:inline">/</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div className="space-y-6">{children}</div>
        <aside className="space-y-6 lg:sticky lg:top-10">{sidebar}</aside>
      </div>
    </div>
  );
}
