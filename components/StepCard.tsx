import type { ReactNode } from "react";

type StepCardProps = {
  title: string;
  description?: string;
  badge?: ReactNode;
  isActive?: boolean;
  summary?: ReactNode;
  children?: ReactNode;
};

export default function StepCard({
  title,
  description,
  badge,
  isActive = false,
  summary,
  children
}: StepCardProps) {
  return (
    <section
      className={`rounded-2xl border border-slate-800/80 bg-slate-900/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur-sm transition ${
        isActive ? "ring-1 ring-blue-500/40" : "opacity-80"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white sm:text-2xl">{title}</h2>
          {description ? (
            <p className="mt-2 text-sm text-slate-400">{description}</p>
          ) : null}
        </div>
        {badge}
      </div>
      {isActive ? (
        <div className="mt-6 space-y-6">{children}</div>
      ) : summary ? (
        <div className="mt-4 text-sm text-slate-400">{summary}</div>
      ) : null}
    </section>
  );
}
