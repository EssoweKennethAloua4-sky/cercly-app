export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="cercly-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2563eb" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="32" r="14" fill="none" stroke="url(#cercly-g)" strokeWidth="6" />
      <circle cx="40" cy="32" r="14" fill="none" stroke="url(#cercly-g)" strokeWidth="6" />
    </svg>
  )
}
