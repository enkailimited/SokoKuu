import { useEffect, useMemo, useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import type { Locale } from '../data/i18n';
import {
  EMPTY_TANZANIA_ADDRESS,
  getTanzaniaDistricts,
  getTanzaniaRegions,
  getTanzaniaStreets,
  getTanzaniaWards,
  type TanzaniaAddress,
  type TzDistrict,
  type TzRegion,
  type TzStreet,
  type TzWard,
} from '../services/tanzaniaLocations';

interface TanzaniaLocationFieldsProps {
  locale: Locale;
  value: TanzaniaAddress;
  onChange: (address: TanzaniaAddress) => void;
  idPrefix?: string;
}

const labelClass = 'block text-xs font-semibold text-slate-700';
const selectClass =
  'w-full min-h-[44px] px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:border-emerald-600 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500';

/**
 * Cascading selects backed by the real Tanzanian administrative dataset.
 * Country is fixed to Tanzania; region → district → ward → street narrow down
 * from the official postcode datasets. No address is typed manually.
 */
export function TanzaniaLocationFields({
  locale,
  value,
  onChange,
  idPrefix = 'tz-location',
}: TanzaniaLocationFieldsProps) {
  const isSw = locale === 'sw';
  const [regions, setRegions] = useState<TzRegion[]>([]);
  const [districts, setDistricts] = useState<TzDistrict[]>([]);
  const [wards, setWards] = useState<TzWard[]>([]);
  const [streets, setStreets] = useState<TzStreet[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState(false);

  const region = useMemo(
    () => regions.find((r) => r.name === value.region),
    [regions, value.region],
  );
  const district = useMemo(
    () => districts.find((d) => d.name === value.district),
    [districts, value.district],
  );
  const ward = useMemo(
    () => wards.find((w) => w.name === value.ward),
    [wards, value.ward],
  );

  useEffect(() => {
    let active = true;
    getTanzaniaRegions()
      .then((rows) => {
        if (active) setRegions(rows);
      })
      .catch(() => active && setDataError(true))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!region?.slug) {
      setDistricts([]);
      return;
    }
    getTanzaniaDistricts(region.slug)
      .then((rows) => active && setDistricts(rows))
      .catch(() => active && setDataError(true));
    return () => {
      active = false;
    };
  }, [region?.slug]);

  useEffect(() => {
    let active = true;
    if (!region?.slug || !district?.slug) {
      setWards([]);
      return;
    }
    getTanzaniaWards(region.slug, district.slug)
      .then((rows) => active && setWards(rows))
      .catch(() => active && setDataError(true));
    return () => {
      active = false;
    };
  }, [region?.slug, district?.slug]);

  useEffect(() => {
    let active = true;
    if (!region?.slug || !district?.slug || !ward?.slug) {
      setStreets([]);
      return;
    }
    getTanzaniaStreets(region.slug, district.slug, ward.slug)
      .then((rows) => active && setStreets(rows))
      .catch(() => active && setDataError(true));
    return () => {
      active = false;
    };
  }, [region?.slug, district?.slug, ward?.slug]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        <MapPin className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
        {isSw ? 'Mahali (Mikoa, Wilaya, Kata, Mtaa)' : 'Location (Region, District, Ward, Street)'}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1.5">
          <span className={labelClass}>{isSw ? 'Nchi' : 'Country'}</span>
          <input
            type="text"
            readOnly
            value="Tanzania"
            className={selectClass}
            aria-label={isSw ? 'Nchi' : 'Country'}
          />
        </label>

        <label className="space-y-1.5">
          <span className={labelClass}>{isSw ? 'Mkoa' : 'Region'}</span>
          <select
            id={`${idPrefix}-region`}
            required
            value={value.region}
            onChange={(e) =>
              onChange({ ...EMPTY_TANZANIA_ADDRESS, region: e.target.value })
            }
            className={selectClass}
          >
            <option value="">
              {loading
                ? isSw
                  ? 'Inapakia mikoa...'
                  : 'Loading regions...'
                : isSw
                  ? 'Chagua mkoa'
                  : 'Select region'}
            </option>
            {regions.map((r) => (
              <option key={r.slug} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className={labelClass}>{isSw ? 'Wilaya' : 'District'}</span>
          <select
            id={`${idPrefix}-district`}
            required
            value={value.district}
            disabled={!region}
            onChange={(e) =>
              onChange({
                ...EMPTY_TANZANIA_ADDRESS,
                region: value.region,
                district: e.target.value,
              })
            }
            className={selectClass}
          >
            <option value="">
              {!region
                ? isSw
                  ? 'Chagua mkoa kwanza'
                  : 'Select a region first'
                : isSw
                  ? 'Chagua wilaya'
                  : 'Select district'}
            </option>
            {districts.map((d) => (
              <option key={d.slug} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className={labelClass}>{isSw ? 'Kata / Ward' : 'Ward'}</span>
          <select
            id={`${idPrefix}-ward`}
            required
            value={value.ward}
            disabled={!district}
            onChange={(e) => {
              const selected = wards.find((w) => w.name === e.target.value);
              onChange({
                ...EMPTY_TANZANIA_ADDRESS,
                region: value.region,
                district: value.district,
                ward: e.target.value,
                postcode: selected?.postcode ?? '',
              });
            }}
            className={selectClass}
          >
            <option value="">
              {!district
                ? isSw
                  ? 'Chagua wilaya kwanza'
                  : 'Select a district first'
                : isSw
                  ? 'Chagua kata'
                  : 'Select ward'}
            </option>
            {wards.map((w) => (
              <option key={w.slug} value={w.name}>
                {w.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className={labelClass}>{isSw ? 'Mtaa / Street' : 'Street'}</span>
          <select
            id={`${idPrefix}-street`}
            value={value.street}
            disabled={!ward}
            onChange={(e) => {
              const selected = streets.find((s) => s.name === e.target.value);
              onChange({
                ...value,
                street: e.target.value,
                postcode: selected?.postcode ?? value.postcode,
              });
            }}
            className={selectClass}
          >
            <option value="">
              {!ward
                ? isSw
                  ? 'Chagua kata kwanza'
                  : 'Select a ward first'
                : isSw
                  ? 'Chagua mtaa (hiari)'
                  : 'Select street (optional)'}
            </option>
            {streets.map((s) => (
              <option key={`${s.name}-${s.postcode}`} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className={labelClass}>{isSw ? 'Postikodi' : 'Postcode'}</span>
          <input
            type="text"
            readOnly
            value={value.postcode}
            placeholder="———"
            className={selectClass}
          />
        </label>
      </div>

      {(loading || dataError) && (
        <p
          className={`text-[11px] flex items-center gap-1.5 ${
            dataError ? 'text-amber-700' : 'text-slate-500'
          }`}
        >
          {loading && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
          {dataError
            ? isSw
              ? 'Data ya maeneo haipatikani kwa sasa; jaribu tena.'
              : 'Location data is temporarily unavailable; please retry.'
            : isSw
              ? 'Inatumia orodha rasmi ya mikoa, wilaya, kata na mitaa ya Tanzania.'
              : 'Using the official Tanzania region, district, ward and street list.'}
        </p>
      )}
    </div>
  );
}
