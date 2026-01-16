type ProgressBarProps = {
  pct: number;
};

export default function ProgressBar({ pct }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, pct));

  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>Progress</span>
        <span>{clamped.toFixed(0)}%</span>
      </div>
      <div className="mt-2 h-2 w-full rounded-full bg-slate-800">
        <div
          className="h-2 rounded-full bg-emerald-500 transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
