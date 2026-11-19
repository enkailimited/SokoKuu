import { useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, Trash2, TriangleAlert } from 'lucide-react';
import type { Locale } from '../data/i18n';
import { SokoApiClient, SokoHttpError, isSokoNetworkError } from '../services/sokoApiClient';

const IMAGEKIT_CDN_REGEX = /^https:\/\/ik\.imagekit\.io\/[a-zA-Z0-9_-]+\/.+$/;
const IMAGEKIT_UPLOAD_URL = 'https://upload.imagekit.io/api/v1/files/upload';
const SAFE_FOLDER_REGEX = /^\/[a-zA-Z0-9/_-]*$/;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

interface ImageKitSignatureResponse {
  publicKey: string;
  urlEndpoint: string;
  signature: string;
  expire: number;
  token: string;
  folder: string;
  fileName: string;
}

function describeUploadError(err: unknown, isSw: boolean): string {
  const prefix = isSw ? 'Picha haikupakiwa' : 'Image upload failed';
  if (err instanceof SokoHttpError) {
    return `${prefix} (HTTP ${err.status}): ${err.message}`;
  }
  if (isSokoNetworkError(err)) {
    return isSw
      ? 'Picha haikupakiwa: hakuna muunganisho na SokoKuu API.'
      : 'Image upload failed: SokoKuu API is unreachable.';
  }
  return err instanceof Error ? `${prefix}: ${err.message}` : prefix;
}

/**
 * Signed ImageKit uploader.
 *
 * The file goes straight from the browser to ImageKit. Only the returned CDN
 * URL is handed back through `onChange` so callers persist a URL string in
 * PostgreSQL — never image bytes. The UI deliberately shows the resulting
 * image only; no file name, no raw URL and no "No file chosen" text.
 */
export function ImageKitUpload({
  locale,
  value,
  onChange,
  folder = '/sokokuu',
  label,
  disabled = false,
}: {
  locale: Locale;
  value: string;
  onChange: (url: string) => void;
  folder?: string;
  label?: string;
  disabled?: boolean;
}) {
  const isSw = locale === 'sw';
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);

    if (!file.type.startsWith('image/')) {
      setError(
        isSw
          ? 'Chagua faili la picha tu (JPEG, PNG, WebP au GIF).'
          : 'Select an image file only (JPEG, PNG, WebP or GIF).'
      );
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(
        isSw
          ? 'Picha ni kubwa mno. Ukubwa wa juu ni 8 MB.'
          : 'Image is too large. Maximum size is 8 MB.'
      );
      return;
    }
    if (!SAFE_FOLDER_REGEX.test(folder)) {
      setError(
        isSw
          ? 'Folda ya ImageKit si sahihi.'
          : 'The ImageKit folder path is not valid.'
      );
      return;
    }

    setUploading(true);
    try {
      const safeFileName =
        file.name.replace(/[^a-zA-Z0-9._() -]/g, '-').slice(0, 160) || `sokokuu-${Date.now()}.webp`;
      const signature = await SokoApiClient.post<ImageKitSignatureResponse>(
        '/uploads/imagekit/signature',
        { folder, fileName: safeFileName },
      );

      const form = new FormData();
      form.set('file', file);
      form.set('publicKey', signature.publicKey);
      form.set('token', signature.token);
      form.set('expire', String(signature.expire));
      form.set('signature', signature.signature);
      form.set('folder', signature.folder);
      form.set('fileName', signature.fileName);
      form.set('useUniqueFileName', 'true');

      const uploadResponse = await fetch(IMAGEKIT_UPLOAD_URL, {
        method: 'POST',
        body: form,
      });
      const uploadBody = (await uploadResponse.json().catch(() => ({}))) as {
        url?: string;
        message?: string;
      };
      if (!uploadResponse.ok) {
        throw new Error(
          uploadBody.message ||
            (isSw
              ? `ImageKit ilikataa picha (HTTP ${uploadResponse.status}).`
              : `ImageKit rejected the upload (HTTP ${uploadResponse.status}).`),
        );
      }
      const cdnUrl = String(uploadBody.url ?? '');
      if (!IMAGEKIT_CDN_REGEX.test(cdnUrl)) {
        throw new Error(
          isSw
            ? 'ImageKit haikurudisha anuani halali ya CDN.'
            : 'ImageKit did not return a valid CDN URL.'
        );
      }

      // Only the CDN URL crosses into application state / PostgreSQL.
      onChange(cdnUrl);
    } catch (err) {
      setError(describeUploadError(err, isSw));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const openPicker = () => {
    if (disabled || uploading) return;
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-2">
      {label && (
        <label className="text-xs font-semibold text-slate-700 block">
          {label}
        </label>
      )}

      <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          tabIndex={-1}
          disabled={disabled || uploading}
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />

        <button
          type="button"
          onClick={openPicker}
          disabled={disabled || uploading}
          aria-label={isSw ? 'Pakia au badilisha picha' : 'Upload or replace image'}
          title={isSw ? 'Pakia au badilisha picha' : 'Upload or replace image'}
          className="relative w-20 h-20 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden shrink-0 flex items-center justify-center cursor-pointer hover:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
        >
          {value && IMAGEKIT_CDN_REGEX.test(value) ? (
            <img
              src={value}
              alt={isSw ? 'Picha ya bidhaa' : 'Product image'}
              className="w-full h-full object-cover"
            />
          ) : (
            <ImagePlus className="w-6 h-6 text-slate-400" aria-hidden="true" />
          )}
          {uploading && (
            <span className="absolute inset-0 flex items-center justify-center bg-white/70">
              <LoaderCircle className="w-6 h-6 animate-spin text-emerald-700" aria-hidden="true" />
            </span>
          )}
        </button>

        {value && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange('');
              setError(null);
            }}
            aria-label={isSw ? 'Futa picha' : 'Remove image'}
            title={isSw ? 'Futa picha' : 'Remove image'}
            className="w-9 h-9 rounded-lg border border-red-200 bg-white text-red-700 hover:bg-red-50 flex items-center justify-center cursor-pointer disabled:opacity-60"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="text-[11px] font-medium text-red-800 bg-red-50 border border-red-200 rounded-md p-2.5 inline-flex items-start gap-1.5"
        >
          <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
