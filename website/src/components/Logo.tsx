type LogoProps = {
  compact?: boolean;
  className?: string;
};

export default function Logo({ compact = false, className = '' }: LogoProps) {
  return (
    <div className={`inline-flex items-center gap-3 ${className}`} aria-label="HammaDev">
      <span className="logo-mark" aria-hidden="true">
        <span className="logo-node logo-node-a" />
        <span className="logo-node logo-node-b" />
        <span className="logo-bridge" />
      </span>
      {!compact && (
        <span className="text-[15px] font-semibold tracking-[-0.02em] text-slate-900">
          Hamma<span className="text-violet-600">Dev</span>
        </span>
      )}
    </div>
  );
}
