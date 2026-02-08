import type { ButtonHTMLAttributes } from "react";

const baseClasses =
  "inline-flex items-center justify-center rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50";

export default function PrimaryButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={className ? `${baseClasses} ${className}` : baseClasses}
      {...props}
    />
  );
}
