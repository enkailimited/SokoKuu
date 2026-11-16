export const SOKOKUU_BRAND_LOGO_URL = '/sokokuu-brand-logo.svg';

export function BrandLogo({
  size = 'md',
  showWordmark = true,
  subtitle,
}: {
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
  subtitle?: string;
}) {
  const heightClass =
    size === 'sm' ? 'h-8' : size === 'lg' ? 'h-14' : 'h-10';

  return (
    <span className="inline-flex flex-col items-start shrink-0 leading-none">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 680 216"
        role="img"
        aria-label="SokoKuu — Nunua • Uza • Jisajili"
        shapeRendering="geometricPrecision"
        className={`${heightClass} w-auto max-w-[220px] select-none`}
      >
        {/* Upper-left deep navy swoosh arc */}
        <path
          d="M126 59 C232 23, 376 7, 514 8 L496 29 C372 28, 240 38, 126 59 Z"
          fill="#00216B"
        />
        {/* Upper-right & right-edge bright emerald swoosh hook */}
        <path
          d="M509 8 C596 8, 650 11, 665 32 C676 48, 672 92, 652 140 C639 170, 622 184, 594 186 L576 186 C600 172, 616 144, 628 96 C635 64, 636 44, 625 35 C612 26, 566 28, 492 29 Z"
          fill="#00BF00"
        />

        {/* Heavy italic SokoKuu wordmark */}
        <g transform="translate(324, 146) skewX(-11)">
          <text
            x="0"
            y="0"
            textAnchor="middle"
            fontFamily="'Plus Jakarta Sans', 'DM Sans', 'Segoe UI', system-ui, sans-serif"
            fontWeight="800"
            fontSize="112"
            letterSpacing="-3.5"
          >
            <tspan fill="#00216B">Soko</tspan>
            <tspan fill="#00BF00">Kuu</tspan>
          </text>
        </g>

        {/* Left & right tapered accent spear bars */}
        <polygon points="16,179 138,175 138,183" fill="#00216B" />
        <polygon points="512,175 636,179 512,183" fill="#00216B" />

        {/* Centered tagline with vibrant green dot separators */}
        <text
          x="325"
          y="188"
          textAnchor="middle"
          fontFamily="'Plus Jakarta Sans', 'DM Sans', 'Segoe UI', Arial, sans-serif"
          fontWeight="700"
          fontStyle="italic"
          fontSize="29"
          letterSpacing="0.2"
          fill="#00216B"
        >
          Nunua{' '}
          <tspan fill="#00BF00" fontStyle="normal" fontSize="32" dy="1">
            &#8226;
          </tspan>
          <tspan dy="-1"> Uza </tspan>
          <tspan fill="#00BF00" fontStyle="normal" fontSize="32" dy="1">
            &#8226;
          </tspan>
          <tspan dy="-1"> Jisajili</tspan>
        </text>
      </svg>

      {showWordmark && subtitle && (
        <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap mt-1">
          {subtitle}
        </span>
      )}
    </span>
  );
}

export default BrandLogo;
