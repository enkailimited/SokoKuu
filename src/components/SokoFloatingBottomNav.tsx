import type { LucideIcon } from 'lucide-react';
import { Calculator, LayoutDashboard, Settings, Store } from 'lucide-react';
import { t, type I18nKey, type Locale } from '../i18n';
import { SokoKuuAppIcon } from './BrandLogo';

export type FloatingBottomNavTab = 'dashboard' | 'sokoni' | 'pos' | 'settings';

type SokoFloatingBottomNavProps = {
  locale: Locale;
  activeTab: FloatingBottomNavTab;
  onSelectTab: (tab: FloatingBottomNavTab) => void;
  /** Shows a small unread dot on the marketplace/orders tab. */
  hasUnreadAlerts?: boolean;
};

const TAB_ICONS: Record<FloatingBottomNavTab, LucideIcon> = {
  dashboard: LayoutDashboard,
  sokoni: Store,
  pos: Calculator,
  settings: Settings,
};

const TAB_LABEL_KEYS: Record<FloatingBottomNavTab, I18nKey> = {
  dashboard: 'nav.dashboard',
  sokoni: 'nav.sokoni',
  pos: 'nav.pos',
  settings: 'nav.settings',
};

const TABS: FloatingBottomNavTab[] = ['dashboard', 'sokoni', 'pos', 'settings'];

export function SokoFloatingBottomNav({
  locale,
  activeTab,
  onSelectTab,
  hasUnreadAlerts = false,
}: SokoFloatingBottomNavProps) {
  const activeIndex = Math.max(0, TABS.indexOf(activeTab));
  const activeTabCenterPercent = ((activeIndex + 0.5) / TABS.length) * 100;
  const waveOffsetPercent = (activeTabCenterPercent - 150) / 3;

  return (
    <nav
      aria-label={locale === 'sw' ? 'Urambazaji wa Chini' : 'Bottom navigation'}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[95%] max-w-md rounded-full border border-[#0066CC]/50 bg-[#0054A6] px-2 py-1.5 shadow-[0_14px_34px_-6px_rgba(0,84,166,0.5),inset_0_1px_0_rgba(255,255,255,0.2)] backdrop-blur-md"
      style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-center gap-1.5">
        {/* Left brand medallion — white circle with SokoKuu green emblem */}
        <button
          type="button"
          onClick={() => onSelectTab('dashboard')}
          aria-label={locale === 'sw' ? 'Rudi Dashibodi' : 'Back to dashboard'}
          className="sk-brand-light flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white shadow-[0_4px_12px_rgba(0,0,0,0.22)] ring-2 ring-[#15AC49] transition-transform duration-200 active:scale-95 cursor-pointer"
        >
          <SokoKuuAppIcon sizeClass="h-7 w-7" animated={false} />
        </button>

        <div className="relative min-w-0 flex-1 overflow-hidden rounded-r-full pr-1">
          {/* Green arch lives in the icon zone only — labels sit below its baseline. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[34px] overflow-hidden" aria-hidden="true">
            <svg
              className="absolute inset-0 h-full w-[300%] transition-transform duration-300 ease-out"
              style={{ transform: `translateX(${waveOffsetPercent}%)` }}
              viewBox="0 0 1200 60"
              preserveAspectRatio="none"
              fill="none"
            >
              {/* Subtle dark-blue fill inside the arch for contrast */}
              <path
                d="M558 56 C568 56 572 48 575 26 C578 9 587 4 600 4 C613 4 622 9 625 26 C628 48 632 56 642 56 Z"
                fill="rgba(0, 38, 77, 0.45)"
              />
              {/* Crisp continuous green stroke */}
              <path
                d="M0 56 H558 C568 56 572 48 575 26 C578 9 587 4 600 4 C613 4 622 9 625 26 C628 48 632 56 642 56 H1200"
                stroke="#22C55E"
                strokeWidth="2.5"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>

          <div className="relative z-10 grid grid-cols-4 items-center">
            {TABS.map((tab) => {
              const active = tab === activeTab;
              const Icon = TAB_ICONS[tab];
              const label = t(locale, TAB_LABEL_KEYS[tab]);
              const showUnreadDot = hasUnreadAlerts && (tab === 'sokoni' || tab === 'pos');

              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => onSelectTab(tab)}
                  aria-current={active ? 'page' : undefined}
                  aria-label={label}
                  className="relative flex h-[50px] flex-col items-center justify-start pt-2 transition-colors duration-200 cursor-pointer"
                >
                  {showUnreadDot && (
                    <span
                      className="absolute right-[22%] top-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-[#0054A6]"
                      aria-hidden="true"
                    />
                  )}
                  <Icon
                    className={`h-[18px] w-[18px] transition-transform duration-200 ${
                      active
                        ? 'text-white scale-110'
                        : 'text-white/70 hover:text-white'
                    }`}
                    strokeWidth={active ? 2.5 : 1.75}
                    fill="none"
                    aria-hidden="true"
                  />
                  <span
                    className={`mt-2.5 max-w-full truncate px-0.5 leading-none tracking-tight whitespace-nowrap ${
                      active
                        ? 'text-[10px] font-extrabold text-white'
                        : 'text-[9.5px] font-medium text-white/75'
                    }`}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
