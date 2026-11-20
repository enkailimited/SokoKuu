import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  ChevronDown,
  Languages,
  MapPin,
  Package,
  ShieldCheck,
  Smartphone,
  Store,
  Truck,
  Users,
  WifiOff,
} from 'lucide-react';
import type { Locale } from '../data/i18n';
import { BrandLogo } from './BrandLogo';
import { PWAInstallButton } from './PWAInstallButton';

interface PublicLandingViewProps {
  locale: Locale;
  onToggleLocale: () => void;
  onEnter: () => void;
}

const DOT_GRID = {
  backgroundImage: 'radial-gradient(#065f46 1px, transparent 1px)',
  backgroundSize: '22px 22px',
};

/** Reveals its children once, with an optional stagger delay, as they scroll in. */
function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`sk-reveal ${visible ? 'is-visible' : ''} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

export function PublicLandingView({ locale, onToggleLocale, onEnter }: PublicLandingViewProps) {
  const isSw = locale === 'sw';

  const services = isSw
    ? [
        {
          icon: Package,
          title: 'Bidha Kwa Jumla',
          text: 'Pata wauzaji na wasambazaji waliothibitishwa, linganisha bei na weka oda kwa wingi kwa urahisi.',
        },
        {
          icon: Smartphone,
          title: 'Nunua Mtandaoni',
          text: 'Tafuta bidha, weka oda na upokee uthibitisho wa haraka moja kwa moja kwenye simu yako.',
        },
        {
          icon: Store,
          title: 'POS ya Duka',
          text: 'Fanya mauzo ya haraka, simamia hisa na toa risiti za kidijitali bila karatasi.',
        },
        {
          icon: Truck,
          title: 'Usafirishaji na Ufuatiliaji',
          text: 'Fuatilia oda kutoka sokoni hadi mlangoni, na upokee arifa kila hatua.',
        },
        {
          icon: Bell,
          title: 'Arifa za Wakati Halisi',
          text: 'Pokea kengele za oda mpya, malipo na usafirishaji hata kivinjari kikifungwa.',
        },
        {
          icon: WifiOff,
          title: 'Inafanya Kazi Offline',
          text: 'Endelea kufanya mauzo na kuhifadhi oda hata bila intaneti; zitasawazishwa zikirejea.',
        },
      ]
    : [
        {
          icon: Package,
          title: 'Wholesale Goods',
          text: 'Find verified suppliers, compare prices and place bulk orders with ease.',
        },
        {
          icon: Smartphone,
          title: 'Buy Online',
          text: 'Search products, place orders and get instant confirmations on your phone.',
        },
        {
          icon: Store,
          title: 'Retail POS',
          text: 'Sell fast, manage stock and issue digital receipts without paper.',
        },
        {
          icon: Truck,
          title: 'Delivery Tracking',
          text: 'Follow every order from marketplace to your doorstep with live alerts.',
        },
        {
          icon: Bell,
          title: 'Real-Time Alerts',
          text: 'Get order, payment and delivery notifications even when the browser is closed.',
        },
        {
          icon: WifiOff,
          title: 'Works Offline',
          text: 'Keep selling and recording orders without internet; they sync when you reconnect.',
        },
      ];

  const steps = isSw
    ? [
        ['Jisajili', 'Fungua akaunti ya muuzaji, duka, mtengenezaji au mnunuzi kwa dakika chache.'],
        ['Tafuta au Weka Bidha', 'Vinjari soko, linganisha bei za bidha kwa jumla, au weka bidha zako sokoni.'],
        ['Weka Oda na Ufuatilie', 'Lipa, thibitisha kwa PIN na upokee arifa hadi bidha zifike.'],
      ]
    : [
        ['Sign Up', 'Create a seller, shop, supplier or buyer account in minutes.'],
        ['Find or List Products', 'Browse the marketplace, compare wholesale prices or publish your goods.'],
        ['Order and Track', 'Pay, confirm with a PIN and follow alerts until delivery.'],
      ];

  return (
    <div className="min-h-dvh bg-white text-slate-900 flex flex-col overflow-x-hidden sk-safe-x">
      <header className="h-16 px-5 sm:px-8 bg-white/90 backdrop-blur-md border-b border-slate-100 flex items-center justify-between gap-4 sticky top-0 z-30">
        <BrandLogo size="md" />
        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton locale={locale} />
          <button
            type="button"
            onClick={onToggleLocale}
            className="hidden sm:inline-flex items-center gap-1.5 min-h-[36px] px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer"
          >
            <Languages className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            <span>{isSw ? 'English' : 'Kiswahili'}</span>
          </button>
          <button
            type="button"
            onClick={onEnter}
            className="group inline-flex items-center gap-1.5 min-h-[36px] px-3 sm:px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm shadow-emerald-600/20 cursor-pointer"
          >
            <span>{isSw ? 'Ingia' : 'Sign In'}</span>
            <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </button>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden bg-gradient-to-b from-emerald-50 via-emerald-50/30 to-white border-b border-slate-100">
          <div aria-hidden="true" className="sk-float-slow pointer-events-none absolute -top-28 -right-24 h-80 w-80 rounded-full bg-emerald-200/50 blur-3xl" />
          <div aria-hidden="true" className="sk-float-slower pointer-events-none absolute -bottom-36 -left-24 h-80 w-80 rounded-full bg-teal-100/60 blur-3xl" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.045]" style={DOT_GRID} />
          <div className="relative mx-auto max-w-5xl px-6 py-16 sm:py-24 space-y-7">
            <Reveal delay={0}>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 shadow-sm backdrop-blur">
                <span className="h-2 w-2 rounded-full bg-emerald-500 ring-4 ring-emerald-100" />
                <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                {isSw ? 'SokoKuu TZ · Imetengenezwa Tanzania' : 'SokoKuu TZ · Made for Tanzania'}
              </div>
            </Reveal>
            <Reveal delay={90}>
              <h1 className="text-4xl sm:text-6xl font-extrabold leading-[1.1] tracking-tight text-slate-950">
                {isSw ? (
                  <>
                    Soko Kuu Tanzani la{' '}
                    <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
                      Bidha Kwa Jumla
                    </span>
                    , POS na Nunua Mtandaoni
                  </>
                ) : (
                  <>
                    Tanzania&apos;s wholesale marketplace, retail POS and{' '}
                    <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
                      buy online
                    </span>{' '}
                    platform
                  </>
                )}
              </h1>
            </Reveal>
            <Reveal delay={170}>
              <p className="max-w-2xl text-sm sm:text-base leading-relaxed text-slate-600">
                {isSw
                  ? 'SokoKuu TZ inaunganisha wafanyabiashara, wauzaji wa jumla, wasambazaji na wanunuzi kote nchini. Pata bidha kwa jumla, weka oda, simamia duka lako na ufuatilie usafirishaji — yote kwenye app moja inayofanya kazi hata bila intaneti.'
                  : 'SokoKuu TZ connects traders, wholesalers, suppliers and buyers across Tanzania. Source wholesale goods, place orders, run your shop and track deliveries — all in one app that works even offline.'}
              </p>
            </Reveal>
            <Reveal delay={250}>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onEnter}
                  className="group inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/20 hover:shadow-xl hover:-translate-y-0.5 cursor-pointer"
                >
                  {isSw ? 'Anza Sasa — Ni Bure' : 'Get Started — It’s Free'}
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </button>
                <a
                  href="#huduma"
                  className="group inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 hover:bg-white hover:-translate-y-0.5 px-6 py-3.5 text-sm font-bold text-slate-800 shadow-sm backdrop-blur cursor-pointer"
                >
                  {isSw ? 'Angalia Huduma' : 'See Services'}
                  <ChevronDown className="w-4 h-4 transition-transform group-hover:translate-y-0.5" aria-hidden="true" />
                </a>
              </div>
            </Reveal>
            <Reveal delay={330}>
              <ul className="flex flex-wrap gap-x-6 gap-y-2 pt-3 text-[11px] font-medium text-slate-600">
                {[
                  isSw ? 'Bila malipo kuanza' : 'Free to start',
                  isSw ? 'Inafanya kazi offline' : 'Works offline',
                  isSw ? 'Wauzaji waliothibitishwa' : 'Verified sellers',
                  isSw ? 'Arifa za wakati halisi' : 'Real-time alerts',
                ].map((item) => (
                  <li key={item} className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
          <a
            href="#huduma"
            aria-label={isSw ? 'Gundua zaidi' : 'Scroll to explore'}
            className="sk-bounce-soft absolute bottom-4 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-1 text-emerald-700 sm:flex"
          >
            <span className="text-[10px] font-semibold uppercase tracking-widest">
              {isSw ? 'Gundua' : 'Explore'}
            </span>
            <ChevronDown className="w-4 h-4" aria-hidden="true" />
          </a>
        </section>

        {/* Services */}
        <section id="huduma" className="mx-auto max-w-5xl px-6 py-16">
          <Reveal>
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-600">
                {isSw ? 'Tunachokuletea' : 'What we offer'}
              </p>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-950">
                {isSw ? 'Huduma za SokoKuu TZ' : 'What SokoKuu TZ offers'}
              </h2>
              <p className="text-sm text-slate-600 max-w-2xl">
                {isSw
                  ? 'Kutoka bidha kwa jumla hadi mauzo ya dukani na usafirishaji — kila kitu kipo mahali pamoja.'
                  : 'From wholesale goods to in-shop sales and delivery — everything lives in one place.'}
              </p>
            </div>
          </Reveal>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {services.map(({ icon: Icon, title, text }, index) => (
              <Reveal key={title} delay={index * 80}>
                <div className="group h-full rounded-2xl border border-slate-200/80 bg-white p-6 space-y-3 shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:border-emerald-200 hover:shadow-xl hover:shadow-emerald-900/5">
                  <div className="w-11 h-11 rounded-xl bg-emerald-50 group-hover:bg-emerald-100 group-hover:scale-110 flex items-center justify-center transition-all duration-300">
                    <Icon className="w-5 h-5 text-emerald-600" aria-hidden="true" />
                  </div>
                  <h3 className="text-sm font-bold text-slate-900">{title}</h3>
                  <p className="text-xs leading-relaxed text-slate-600">{text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="border-y border-slate-100 bg-slate-50/60">
          <div className="mx-auto max-w-5xl px-6 py-16">
            <Reveal>
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-600">
                  {isSw ? 'Rahisi na Haraka' : 'Simple & fast'}
                </p>
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-950">
                  {isSw ? 'Jinsi Inavyofanya Kazi' : 'How it works'}
                </h2>
              </div>
            </Reveal>
            <div className="relative mt-9 grid gap-9 sm:grid-cols-3">
              <div aria-hidden="true" className="absolute left-5 right-5 top-4 hidden h-px bg-gradient-to-r from-emerald-200 via-emerald-300 to-emerald-200 sm:block" />
              {steps.map(([title, text], index) => (
                <Reveal key={title} delay={index * 120}>
                  <div className="relative space-y-2">
                    <div className="relative z-10 w-9 h-9 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center ring-4 ring-slate-50 transition-transform duration-300 hover:scale-110">
                      {index + 1}
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">{title}</h3>
                    <p className="text-xs leading-relaxed text-slate-600">{text}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Audiences + SEO alias content */}
        <section className="mx-auto max-w-5xl px-6 py-16 space-y-6">
          <Reveal>
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-600">
                {isSw ? 'Kwa Wote' : 'For everyone'}
              </p>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-950">
                {isSw
                  ? 'SokoKuu Kwa Kila Mfanyabiashara Tanzania'
                  : 'SokoKuu for every business in Tanzania'}
              </h2>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <p className="text-sm leading-relaxed text-slate-600 max-w-3xl">
              {isSw
                ? 'Wauzaji wa bidha kwa jumla hupata soko la moja kwa moja la wafanyabiashara; maduka ya rejareja hupata bidha za kuuza na mfumo wa POS; watengenezaji husambaza bidha zao; na wanunuzi wanaweza nunua mtandaoni kwa urahisi. Kila oda ina PIN ya mnunuzi na ya dereva ili kuhakikisha usalama.'
                : 'Wholesalers reach retailers directly, shops stock goods and run POS, manufacturers distribute their products, and buyers can buy online with ease. Every order uses a buyer PIN and a driver PIN for safety.'}
            </p>
          </Reveal>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { icon: Package, label: isSw ? 'Wasambazaji na Watengenezaji' : 'Suppliers & manufacturers' },
              { icon: Store, label: isSw ? 'Wauzaji wa Jumla na Maduka' : 'Wholesalers & shops' },
              { icon: Users, label: isSw ? 'Wanunuzi na Wateja' : 'Buyers & consumers' },
            ].map(({ icon: Icon, label }, index) => (
              <Reveal key={label} delay={index * 90}>
                <div className="group h-full rounded-xl border border-slate-200 bg-white px-4 py-4 flex items-center gap-3 transition-all duration-300 hover:-translate-y-1 hover:border-emerald-200 hover:shadow-md">
                  <span className="w-9 h-9 rounded-lg bg-emerald-50 group-hover:bg-emerald-100 group-hover:scale-110 flex items-center justify-center transition-all duration-300 shrink-0">
                    <Icon className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                  </span>
                  <span className="text-xs font-semibold text-slate-800">{label}</span>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={100}>
            <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/80 via-white to-white p-6 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">
                {isSw ? 'Pia inajulikana kama' : 'Also known as'}
              </h3>
              <p className="text-xs leading-relaxed text-slate-600">
                Soko kuu Tanzani, Sokokuu TZ, Soko kuu Tz, SokoKuu Tanzania, Sokokuu Tanzania, Soko
                Kuu, Nunu Mtandaoni, Nunua Mtandaoni na Bidha Kwa Jumla. SokoKuu TZ ni jukwaa la
                B2B2C la soko la jumla, POS ya rejareja na usambazaji nchini Tanzania.
              </p>
              <p className="flex items-center gap-2 text-[11px] font-medium text-emerald-700">
                <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                {isSw
                  ? 'Wauzaji wote wanaweza kuthibitishwa kabla ya kufanya biashara.'
                  : 'Sellers can be verified before you trade.'}
              </p>
            </div>
          </Reveal>
        </section>

        {/* CTA */}
        <section className="relative overflow-hidden bg-emerald-700">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-10" style={DOT_GRID} />
          <div aria-hidden="true" className="sk-float-slower pointer-events-none absolute -top-24 -right-16 h-72 w-72 rounded-full bg-emerald-500/40 blur-3xl" />
          <Reveal>
            <div className="relative mx-auto max-w-5xl px-6 py-14 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
              <div>
                <h2 className="text-2xl font-extrabold text-white">
                  {isSw ? 'Uko tayari kuanza?' : 'Ready to get started?'}
                </h2>
                <p className="mt-1.5 text-sm text-emerald-50">
                  {isSw
                    ? 'Fungua akaunti yako leo — bila malipo.'
                    : 'Create your account today — free.'}
                </p>
              </div>
              <button
                type="button"
                onClick={onEnter}
                className="group inline-flex items-center gap-2 rounded-xl bg-white hover:bg-emerald-50 hover:-translate-y-0.5 px-6 py-3.5 text-sm font-bold text-emerald-800 shadow-lg cursor-pointer"
              >
                {isSw ? 'Jisajili au Ingia' : 'Register or Sign In'}
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </button>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-slate-100 bg-slate-50/60">
        <div className="mx-auto max-w-5xl px-6 py-9 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <BrandLogo size="sm" />
          <p className="text-[11px] text-slate-500">
            © {new Date().getFullYear()} SokoKuu TZ ·{' '}
            {isSw ? 'Soko kuu Tanzani la bidha kwa jumla.' : 'Tanzania wholesale marketplace.'}
          </p>
        </div>
      </footer>
    </div>
  );
}
