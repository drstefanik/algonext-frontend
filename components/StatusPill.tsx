import type { ReactNode } from "react";

type StatusPillProps = {
  children: ReactNode;
  className?: string;
};

export default function StatusPill({ children, className }: StatusPillProps) {
  const base =
    "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em]";
  return <span className={className ? `${base} ${className}` : base}>{children}</span>;
}
