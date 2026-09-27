export default function Logo({
  className = "h-9 w-9",
  withWordmark = false,
  wordmarkClassName = "text-lg font-bold tracking-tight text-[#d15435]",
}: {
  className?: string;
  withWordmark?: boolean;
  wordmarkClassName?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg
        viewBox="140 10 610 620"
        className={className}
        aria-hidden="true"
        role="img"
      >
        {/* Sol naciente con halo blanco */}
        <circle
          cx="441"
          cy="362"
          r="207"
          fill="#F6A62B"
          stroke="#FFFFFF"
          strokeWidth="18"
        />
        {/* Rayos */}
        <g stroke="#F6A62B" strokeWidth="38" strokeLinecap="round">
          <line x1="449" y1="34" x2="449" y2="120" />
          <line x1="250" y1="84" x2="312" y2="174" />
          <line x1="649" y1="84" x2="587" y2="174" />
          <line x1="163" y1="256" x2="237" y2="284" />
          <line x1="721" y1="256" x2="647" y2="284" />
        </g>
        {/* Barras de progreso ascendentes */}
        <rect x="197" y="502" width="77" height="117" rx="24" fill="#FA9C58" />
        <rect x="292" y="465" width="83" height="154" rx="24" fill="#F2823C" />
        <rect x="394" y="418" width="87" height="201" rx="24" fill="#E9763E" />
        <rect x="499" y="370" width="88" height="249" rx="24" fill="#E66931" />
        <rect x="606" y="319" width="98" height="300" rx="24" fill="#D15433" />
      </svg>
      {withWordmark && <span className={wordmarkClassName}>Hábitos</span>}
    </span>
  );
}
