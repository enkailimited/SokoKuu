import {
  useEffect,
  useState,
  type ChangeEventHandler,
  type InputHTMLAttributes,
} from 'react';

type NumberDraftInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
> & {
  /** Committed numeric value owned by the parent. */
  value: number;
  onValueChange: (value: number) => void;
  /** Value committed while the field is empty. Defaults to 0. */
  fallback?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  /** Keep the field visually empty on blur (useful for optional price fields). */
  allowEmpty?: boolean;
  onChange?: ChangeEventHandler<HTMLInputElement>;
};

/**
 * Controlled numeric input that lets the user clear the field completely.
 *
 * A plain `value={number}` + `onChange={Number(...) || 1}` input immediately
 * re-renders the fallback as soon as the last digit is deleted, so the user
 * can never empty it to type a new value. This component keeps a local string
 * draft while focused (empty allowed) and only commits a clamped number to
 * the parent. On blur the draft resyncs to the committed value.
 */
export function NumberDraftInput({
  value,
  onValueChange,
  fallback = 0,
  min,
  max,
  integer = true,
  allowEmpty = false,
  onFocus,
  onBlur,
  onChange,
  ...rest
}: NumberDraftInputProps) {
  const [draft, setDraft] = useState<string>(() => String(value));
  const [focused, setFocused] = useState(false);

  const clamp = (next: number) =>
    Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min ?? Number.MIN_SAFE_INTEGER, next));
  const emptyValue = clamp(fallback);

  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  return (
    <input
      {...rest}
      type="number"
      value={draft}
      min={min}
      max={max}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        if (draft.trim() === '' && !allowEmpty) {
          setDraft(String(emptyValue));
          onValueChange(emptyValue);
        } else {
          setDraft(String(value));
        }
        onBlur?.(event);
      }}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        onChange?.(event);
        if (raw.trim() === '') {
          onValueChange(allowEmpty ? 0 : emptyValue);
          return;
        }
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return;
        onValueChange(clamp(integer ? Math.trunc(parsed) : parsed));
      }}
    />
  );
}

export default NumberDraftInput;
