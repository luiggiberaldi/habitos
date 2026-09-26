export default function Logo({
  className = "h-9 w-9",
  withWordmark = false,
  wordmarkClassName = "text-lg font-bold tracking-tight",
}: {
  className?: string;
  withWordmark?: boolean;
  wordmarkClassName?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className={`relative inline-flex ${className} items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-strong text-accent-foreground shadow-[0_4px_14px_-4px_var(--accent)]`}
      >
        {/* Dorso: diana */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.1}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-[58%] w-[58%]"
          aria-hidden="true"
        >
          <circle cx="10.5" cy="11" r="8.2" opacity="0.55" />
          <circle cx="10.5" cy="11" r="4.8" opacity="0.8" />
          <circle cx="10.5" cy="11" r="1.6" />
        </svg>
        {/* Marca de verificación en primer plano */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="absolute h-[40%] w-[40%]"
          aria-hidden="true"
        >
          <path d="M5 12.5l4.2 4.2L19 7" />
        </svg>
      </span>
      {withWordmark && <span className={wordmarkClassName}>Hábitos</span>}
    </span>
  );
}
