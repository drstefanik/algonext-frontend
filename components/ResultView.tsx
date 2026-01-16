import type { JobResponse } from "@/lib/api";

const formatScore = (value?: number) => {
  if (value === undefined || value === null) {
    return "—";
  }
  return value.toFixed(1);
};

export default function ResultView({ job }: { job: JobResponse }) {
  const summary = job.result?.summary;
  const radarEntries = Object.entries(job.result?.radar ?? {});
  const clips = job.result?.clips ?? [];

  return (
    <div className="mt-6 space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="text-lg font-semibold text-white">Result Summary</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
              Overall Score
            </p>
            <p className="mt-2 text-3xl font-semibold text-emerald-400">
              {formatScore(summary?.overallScore)}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
              Role
            </p>
            <p className="mt-2 text-xl font-semibold text-white">
              {summary?.playerRole ?? "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h4 className="text-lg font-semibold text-white">Radar Breakdown</h4>
        {radarEntries.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">
            Radar data not available.
          </p>
        ) : (
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {radarEntries.map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg border border-slate-800 bg-slate-950 p-3"
              >
                <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  {label}
                </dt>
                <dd className="mt-1 text-lg font-semibold text-slate-100">
                  {formatScore(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h4 className="text-lg font-semibold text-white">Assets</h4>
        <div className="mt-3 space-y-4 text-sm text-slate-300">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Input Video
            </p>
            {job.result?.assets?.inputVideo?.signedUrl ? (
              <a
                href={job.result.assets.inputVideo.signedUrl}
                className="mt-2 inline-flex items-center gap-2 text-emerald-400 hover:text-emerald-300"
                target="_blank"
                rel="noreferrer"
              >
                Open input video
              </a>
            ) : (
              <p className="mt-2 text-slate-400">No input video link.</p>
            )}
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Clips
            </p>
            {clips.length === 0 ? (
              <p className="mt-2 text-slate-400">No clips available.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {clips.map((clip, index) => (
                  <li
                    key={`${clip.signedUrl ?? "clip"}-${index}`}
                    className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-950 p-3"
                  >
                    <span className="text-xs text-slate-500">
                      {clip.start ?? "?"}s - {clip.end ?? "?"}s
                    </span>
                    {clip.signedUrl ? (
                      <a
                        href={clip.signedUrl}
                        className="text-emerald-400 hover:text-emerald-300"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open clip
                      </a>
                    ) : (
                      <span className="text-slate-400">No clip link.</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
