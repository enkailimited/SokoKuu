import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { CodeArtifact } from '../data/blueprints';
import type { Locale } from '../data/i18n';
import { TRANSLATIONS } from '../data/i18n';

interface CodeViewerProps {
  artifact: CodeArtifact;
  locale: Locale;
}

export function CodeViewer({ artifact, locale }: CodeViewerProps) {
  const [copied, setCopied] = useState(false);
  const t = TRANSLATIONS[locale];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const title = locale === 'sw' ? artifact.titleSw : artifact.title;
  const summary = locale === 'sw' ? artifact.summarySw : artifact.summary;
  const lines = artifact.code.split('\n');

  return (
    <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 border-b border-slate-200 bg-slate-50/70">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-500 font-mono mb-1">
            <span className="truncate">{artifact.filename}</span>
            <span aria-hidden="true">·</span>
            <span className="uppercase">{artifact.language}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{lines.length} lines</span>
          </div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-600 mt-0.5 max-w-3xl">{summary}</p>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
              <span className="text-emerald-800">{t.actions.copied}</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              <span>{t.actions.copyCode}</span>
            </>
          )}
        </button>
      </div>

      <div className="bg-slate-950 text-slate-100 overflow-x-auto max-h-[540px] overflow-y-auto">
        <pre className="p-4 text-[12.5px] leading-relaxed font-mono">
          <code>
            {lines.map((line, idx) => (
              <div key={idx} className="table-row">
                <span className="table-cell select-none pr-4 text-right text-slate-500 tabular-nums w-10">
                  {idx + 1}
                </span>
                <span className="table-cell whitespace-pre text-slate-100">{line || ' '}</span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </section>
  );
}
