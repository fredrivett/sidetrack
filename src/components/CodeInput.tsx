"use client";

import type { Ref } from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { cn } from "@/lib/utils";

/**
 * A 6-digit authenticator code, one box per digit (shadcn's InputOTP, as in
 * Abode). Digits only; pasting or autofilling the whole code fills every box,
 * and `onComplete` fires on the sixth digit so the caller can verify without
 * a click. While `pending` it's read-only rather than disabled, so it keeps
 * focus for the next try.
 */
export function CodeInput({
  id,
  label,
  value,
  onChange,
  onComplete,
  pending,
  autoFocus,
  invalid,
  inputRef,
  wide,
}: {
  id?: string;
  /** Its accessible name, when no <label> points at `id`. */
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onComplete: (value: string) => void;
  pending: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  /** Stretch across its container, as on the sign-in card, with each box
   * square so the row grows taller as it grows wider. */
  wide?: boolean;
}) {
  return (
    <InputOTP
      ref={inputRef}
      id={id}
      aria-label={label}
      maxLength={6}
      pattern={REGEXP_ONLY_DIGITS}
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      readOnly={pending}
      aria-disabled={pending || undefined}
      autoFocus={autoFocus}
      containerClassName={cn("transition-opacity", pending && "opacity-50", wide && "w-full")}
    >
      {/* The row, not each box, is 6:1, so every box gets the same height
          even when the width doesn't divide evenly by six. */}
      <InputOTPGroup className={cn(wide && "aspect-[6/1] w-full")}>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <InputOTPSlot
            key={index}
            index={index}
            aria-invalid={invalid || undefined}
            className={cn(
              "font-mono",
              wide && "h-full w-auto flex-1 text-xl",
            )}
          />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
