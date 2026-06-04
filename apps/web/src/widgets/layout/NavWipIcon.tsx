/** Знак «в разработке» (дорожный конус) — общий символ WIP / under construction. */
export function NavWipIcon() {
  return (
    <span className="navWipBadge" title="Разработка в процессе" aria-label="Разработка в процессе">
      <svg className="navWipBadgeSvg" viewBox="0 0 24 24" width="15" height="15" aria-hidden>
        <path
          fill="currentColor"
          d="M12 2 3 20h18L12 2zm0 3.2 6.1 12.8H5.9L12 5.2zM11 11h2v4h-2v-4zm0 6h2v2h-2v-2z"
        />
      </svg>
    </span>
  );
}
