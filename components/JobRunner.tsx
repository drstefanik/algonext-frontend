"use client";

import { useEffect, useMemo, useState } from "react";
import { createJob, enqueueJob, type JobResponse } from "@/lib/api";
import ProgressBar from "@/components/ProgressBar";
import ResultView from "@/components/ResultView";

const roles = ["Striker", "Winger", "Midfielder", "Defender", "Goalkeeper"];

const statusStyles: Record<string, string> = {
  QUEUED: "bg-slate-800 text-slate-200",
  RUNNING: "bg-blue-500/20 text-blue-200",
  COMPLETED: "bg-emerald-500/20 text-emerald-200",
  FAILED: "bg-rose-500/20 text-rose-200"
};

export default function JobRunner() {
  const [videoUrl, setVideoUrl] = useState("");
  const [role, setRole] = useState("Striker");
  const [category, setCategory] = useState("U17");
  const [shirtNumber, setShirtNumber] = useState<number>(9);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const pct = job?.progress?.pct ?? 0;
  const step = job?.progress?.step ?? "—";
  const displayStatus =
    job?.status === "COMPLETED" ? "COMPLETED" : job?.status ?? "WAITING";

  const statusClass = useMemo(() => {
    if (!displayStatus) {
      return "bg-slate-800 text-slate-200";
    }
    return statusStyles[displayStatus] ?? "bg-slate-800 text-slate-200";
  }, [displayStatus]);

  useEffect(() => {
    if (!jobId || !polling) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, {
          cache: "no-store"
        });
        const data = (await res.json()) as JobResponse;

        setJob(data);

        if (data.status === "COMPLETED" || data.status === "FAILED") {
          clearInterval(interval);
          setPolling(false);
        }
      } catch (pollError) {
        setError((pollError as Error).message);
        setPolling(false);
      }
    }, 2000);

    return () => {
      clearInterval(interval);
    };
  }, [jobId, polling]);

  const handleCreateJob = async () => {
    setError(null);
    if (!videoUrl.trim()) {
      setError("Video URL is required.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await createJob({
        video_url: videoUrl.trim(),
        role,
        category,
        shirt_number: Number(shirtNumber)
      });
      setJobId(response.job_id);
      setJob({ job_id: response.job_id, status: response.status });
    } catch (createError) {
      setError((createError as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnqueue = async () => {
    if (!jobId) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const response = await enqueueJob(jobId);
      setJob(response);
      setPolling(true);
    } catch (enqueueError) {
      setError((enqueueError as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStopPolling = () => {
    setPolling(false);
  };

  const handleReset = () => {
    setVideoUrl("");
    setRole("Striker");
    setCategory("U17");
    setShirtNumber(9);
    setJobId(null);
    setJob(null);
    setError(null);
    setPolling(false);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Create Job</h2>
            <p className="mt-1 text-sm text-slate-400">
              Provide the details for a new analysis request.
            </p>
          </div>
          <span className="rounded-full border border-slate-700 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-400">
            Form
          </span>
        </div>

        <div className="mt-6 space-y-4">
          <label className="block text-sm text-slate-300">
            Video URL
            <textarea
              value={videoUrl}
              onChange={(event) => setVideoUrl(event.target.value)}
              className="mt-2 h-24 w-full resize-none rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
              placeholder="https://..."
            />
          </label>

          <label className="block text-sm text-slate-300">
            Role
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            >
              {roles.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm text-slate-300">
            Category
            <input
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </label>

          <label className="block text-sm text-slate-300">
            Shirt Number
            <input
              type="number"
              value={shirtNumber}
              onChange={(event) => setShirtNumber(Number(event.target.value))}
              className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleCreateJob}
            disabled={submitting}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create Job"}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500"
          >
            Reset
          </button>
        </div>

        {jobId ? (
          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Job Created
            </p>
            <p className="mt-2 text-sm text-slate-200">ID: {jobId}</p>
            <button
              type="button"
              onClick={handleEnqueue}
              disabled={submitting}
              className="mt-3 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Enqueueing..." : "Enqueue"}
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
            {error}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Job Progress</h2>
            <p className="mt-1 text-sm text-slate-400">
              Monitor processing status and output.
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${statusClass}`}
          >
            {displayStatus}
          </span>
        </div>

        <div className="mt-6 space-y-4">
          <ProgressBar pct={pct} />

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Step
            </p>
            <p className="mt-2 text-sm text-slate-200">
              {step}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {job?.progress?.message ?? "No message"}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Created
              </p>
              <p className="mt-2 text-sm text-slate-200">
                {job?.created_at ?? "—"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Updated
              </p>
              <p className="mt-2 text-sm text-slate-200">
                {job?.updated_at ?? "—"}
              </p>
            </div>
          </div>

          {job?.error ? (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
              {job.error}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleStopPolling}
              disabled={!polling}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Stop polling
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500"
            >
              Reset
            </button>
          </div>
        </div>

        {job && job.status === "COMPLETED" ? <ResultView job={job} /> : null}
      </section>
    </div>
  );
}
