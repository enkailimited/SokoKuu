import { useState } from 'react';
import { Package } from 'lucide-react';
import { useDataSaver } from '../context/DataSaverContext';

interface OptimizedProductImageProps {
  skuCode: string;
  productName: string;
  unitSummary: string;
  priceTzs: number;
  estimatedFullSizeKb?: number;
}

/**
 * Renders an inline zero-network SVG/text card when Low-Data Mode is active,
 * preventing heavy raster downloads over expensive Tanzanian 2G/3G mobile bundles.
 */
export function OptimizedProductImage({
  skuCode,
  productName,
  unitSummary,
  priceTzs,
  estimatedFullSizeKb = 185,
}: OptimizedProductImageProps) {
  const { isLowDataModeActive } = useDataSaver();
  const [forceLoadSingle, setForceLoadSingle] = useState(false);

  const showLightweightPlaceholder = isLowDataModeActive && !forceLoadSingle;

  if (showLightweightPlaceholder) {
    return (
      <div className="border border-slate-200 bg-slate-50 rounded-md p-4 flex flex-col justify-between min-h-[140px]">
        <div className="flex items-start justify-between gap-2">
          <div className="inline-flex items-center gap-1.5 text-xs font-mono text-slate-600">
            <Package className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            <span>{skuCode}</span>
          </div>
          <span className="text-[11px] font-mono text-emerald-800 tabular-nums">
            -{estimatedFullSizeKb} KB saved
          </span>
        </div>

        <div className="my-2">
          <div className="text-sm font-semibold text-slate-900">{productName}</div>
          <div className="text-xs text-slate-500 mt-0.5">{unitSummary}</div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200">
          <span className="text-xs font-mono font-semibold tabular-nums text-slate-900">
            TZS {priceTzs.toLocaleString('en-US')}
          </span>
          <button
            type="button"
            onClick={() => setForceLoadSingle(true)}
            className="text-xs font-medium text-emerald-800 hover:underline whitespace-nowrap cursor-pointer"
          >
            Load Preview
          </button>
        </div>
      </div>
    );
  }

  // Standard Mode (or user tapped "Load Preview"): renders crisp vector product card without external image failure
  return (
    <div className="border border-slate-200 bg-white rounded-md overflow-hidden flex flex-col">
      <div className="h-24 bg-slate-900 text-slate-100 px-4 py-3 flex flex-col justify-between">
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-300">
          <span>{skuCode}</span>
          <span className="tabular-nums">WEBP · {estimatedFullSizeKb} KB</span>
        </div>
        <div className="text-sm font-semibold truncate">{productName}</div>
      </div>
      <div className="p-3.5 flex items-center justify-between gap-2">
        <span className="text-xs text-slate-600 truncate">{unitSummary}</span>
        <span className="text-xs font-mono font-semibold tabular-nums text-emerald-800 whitespace-nowrap">
          TZS {priceTzs.toLocaleString('en-US')}
        </span>
      </div>
    </div>
  );
}
