import JobRunner from "@/components/JobRunner";

export default function HomePage() {
  return (
    <main className="min-h-screen px-4 py-10 sm:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">
            AlgoNext
          </p>
          <h1 className="text-3xl font-semibold text-white sm:text-4xl">
            AlgoNext – Video Analysis
          </h1>
          <p className="max-w-2xl text-base text-slate-300">
            Create analysis jobs, enqueue processing, and monitor progress for
            player insights.
          </p>
        </header>
        <JobRunner />
      </div>
    </main>
  );
}
