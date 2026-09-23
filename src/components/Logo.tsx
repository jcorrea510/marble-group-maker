/** Wordmark: three marbles + name. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`logo${compact ? ' logo-compact' : ''}`}>
      <svg className="logo-mark" viewBox="0 0 48 40" aria-hidden="true">
        <defs>
          <radialGradient id="lg-a" cx="35%" cy="30%" r="75%">
            <stop offset="0" stopColor="#fff" stopOpacity=".95" />
            <stop offset=".25" stopColor="#b9a6ff" />
            <stop offset=".7" stopColor="#7c5cff" />
            <stop offset="1" stopColor="#2a1a7a" />
          </radialGradient>
          <radialGradient id="lg-b" cx="35%" cy="30%" r="75%">
            <stop offset="0" stopColor="#fff" stopOpacity=".95" />
            <stop offset=".3" stopColor="#ff9ec4" />
            <stop offset=".75" stopColor="#ff4d8d" />
            <stop offset="1" stopColor="#7a1240" />
          </radialGradient>
          <radialGradient id="lg-c" cx="35%" cy="30%" r="75%">
            <stop offset="0" stopColor="#fff" stopOpacity=".95" />
            <stop offset=".3" stopColor="#a8f3ff" />
            <stop offset=".75" stopColor="#22d3ee" />
            <stop offset="1" stopColor="#0b5566" />
          </radialGradient>
        </defs>
        <circle cx="13" cy="26" r="11" fill="url(#lg-b)" />
        <circle cx="35" cy="27" r="9.5" fill="url(#lg-c)" />
        <circle cx="24" cy="12" r="10" fill="url(#lg-a)" />
      </svg>
      <span className="logo-text">
        Marble <span>Group Maker</span>
      </span>
    </div>
  );
}
