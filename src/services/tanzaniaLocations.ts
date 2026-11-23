/**
 * Offline-friendly lookup for genuine Tanzanian administrative locations.
 *
 * Data is vendored as static JSON under `public/data/tanzania` from the MIT
 * licensed `tz-locations` dataset (31 regions, 168 districts, 4,054 wards and
 * 75,061 streets). Streets are split per region so the browser only downloads
 * the small slice it actually needs.
 */

export interface TzRegion {
  name: string;
  slug: string;
}

export interface TzDistrict {
  name: string;
  slug: string;
  region_slug: string;
}

export interface TzWard {
  name: string;
  slug: string;
  district_slug: string;
  region_slug: string;
  postcode?: string;
}

export interface TzStreet {
  name: string;
  postcode: string;
  ward_slug: string;
  district_slug: string;
  region_slug: string;
}

export interface TanzaniaAddress {
  country: string;
  region: string;
  district: string;
  ward: string;
  street: string;
  postcode: string;
}

export const EMPTY_TANZANIA_ADDRESS: TanzaniaAddress = {
  country: 'Tanzania',
  region: '',
  district: '',
  ward: '',
  street: '',
  postcode: '',
};

const requestCache = new Map<string, Promise<unknown>>();

async function loadJson<T>(path: string): Promise<T> {
  const cached = requestCache.get(path);
  if (cached) return cached as Promise<T>;

  const pending = fetch(path).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Failed to load Tanzania location data (${response.status})`);
    }
    return response.json();
  });

  requestCache.set(path, pending);
  return pending as Promise<T>;
}

const dataUrl = (path: string): string =>
  `${import.meta.env.BASE_URL || '/'}data/tanzania/${path}`;

let regionsPromise: Promise<TzRegion[]> | null = null;
let districtsPromise: Promise<TzDistrict[]> | null = null;
let wardsPromise: Promise<TzWard[]> | null = null;
const streetsByRegion = new Map<string, Promise<TzStreet[]>>();

export function getTanzaniaRegions(): Promise<TzRegion[]> {
  regionsPromise ??= loadJson<TzRegion[]>(dataUrl('regions.json'));
  return regionsPromise;
}

export function getTanzaniaDistricts(regionSlug: string): Promise<TzDistrict[]> {
  districtsPromise ??= loadJson<TzDistrict[]>(dataUrl('districts.json'));
  if (!regionSlug) return Promise.resolve([]);
  return districtsPromise.then((all) => all.filter((d) => d.region_slug === regionSlug));
}

export function getTanzaniaWards(
  regionSlug: string,
  districtSlug: string,
): Promise<TzWard[]> {
  wardsPromise ??= loadJson<TzWard[]>(dataUrl('wards.json'));
  if (!regionSlug || !districtSlug) return Promise.resolve([]);
  return wardsPromise.then((all) =>
    all.filter((w) => w.region_slug === regionSlug && w.district_slug === districtSlug),
  );
}

export function getTanzaniaStreets(
  regionSlug: string,
  districtSlug: string,
  wardSlug: string,
): Promise<TzStreet[]> {
  if (!regionSlug || !districtSlug || !wardSlug) return Promise.resolve([]);

  let regionPromise = streetsByRegion.get(regionSlug);
  if (!regionPromise) {
    regionPromise = loadJson<TzStreet[]>(dataUrl(`streets/${regionSlug}.json`));
    streetsByRegion.set(regionSlug, regionPromise);
  }

  return regionPromise.then((all) =>
    all.filter(
      (s) =>
        s.district_slug === districtSlug &&
        s.ward_slug === wardSlug,
    ),
  );
}

/** Human-readable address line used in lead notes and confirmations. */
export function formatTanzaniaAddress(address: TanzaniaAddress): string {
  return [
    address.street,
    address.ward,
    address.district,
    address.region,
    'Tanzania',
  ]
    .filter(Boolean)
    .join(', ');
}
