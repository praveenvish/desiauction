import { useId, type ReactNode } from "react";
export function FieldSvg({ children, label }: { children: ReactNode; label: string }) {
  const pattern = useId();
  return (
    <svg viewBox="0 0 200 200" role="group" aria-label={label} className="chart-field">
      <defs>
        <pattern id={pattern} width="200" height="24" patternUnits="userSpaceOnUse">
          <rect width="200" height="12" fill="#112E1F" />
          <rect y="12" width="200" height="12" fill="#0E281B" />
        </pattern>
      </defs>
      <g aria-hidden="true">
        <circle cx="100" cy="100" r="92" fill={`url(#${pattern})`} stroke="#E8EEF9" />
        <circle
          cx="100"
          cy="100"
          r="56"
          fill="none"
          stroke="#E8EEF9"
          opacity="0.3"
          strokeDasharray="2 2"
        />
        <rect x="97" y="76" width="6" height="26" rx="2" fill="#C9B48A" />
      </g>
      {children}
    </svg>
  );
}
