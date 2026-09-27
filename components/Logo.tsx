export default function Logo({
  className = "h-9 w-9",
  withWordmark = false,
  wordmarkClassName = "text-lg font-bold tracking-tight text-[#f88858]",
}: {
  className?: string;
  withWordmark?: boolean;
  wordmarkClassName?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg
        viewBox="8 6 120 116"
        className={className}
        aria-hidden="true"
        role="img"
      >
        {/* Barras de progreso ascendentes */}
        <rect x="20" y="91" width="15" height="27" rx="7.5" fill="#FC956A" />
        <rect x="39" y="84" width="15" height="34" rx="7.5" fill="#FC985D" />
        <rect x="59" y="76" width="15" height="42" rx="7.5" fill="#FCA346" />
        <rect x="78" y="67" width="15" height="51" rx="7.5" fill="#FCB723" />
        <rect x="98" y="59" width="15" height="59" rx="7.5" fill="#FCB71E" />
        {/* Sol naciente */}
        <path d="M39 74 A25 31 0 0 1 89 74 Z" fill="#FCB723" />
        {/* Rayos */}
        <g stroke="#FCB723" strokeLinecap="round">
          <line x1="64" y1="34" x2="64" y2="18" strokeWidth="7" />
          <line x1="87" y1="41.2" x2="96.1" y2="28.1" strokeWidth="7" />
          <line x1="41" y1="41.2" x2="31.9" y2="28.1" strokeWidth="7" />
          <line x1="98.6" y1="54" x2="110.8" y2="47" strokeWidth="9" />
          <line x1="29.4" y1="54" x2="17.2" y2="47" strokeWidth="9" />
        </g>
      </svg>
      {withWordmark && <span className={wordmarkClassName}>Hábitos</span>}
    </span>
  );
}
