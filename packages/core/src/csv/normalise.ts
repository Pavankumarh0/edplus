import { PARENT_LANGUAGES, type ParentLanguage } from '../schemas/index';

/**
 * Normalises an Indian phone number to E.164.
 *
 * College spreadsheets carry these in every imaginable shape —
 * `9876543210`, `09876543210`, `91 98765 43210`, `+91-98765-43210` — and a
 * parent call that silently dials the wrong number is worse than one that
 * refuses to dial. So this accepts the common forms and rejects anything it
 * cannot place with confidence, rather than guessing.
 *
 * Returns null when the input cannot be resolved; the caller turns that into a
 * row error.
 */
export function normalisePhone(raw: string, defaultCountryCode = '91'): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  // Already international and explicitly marked as such.
  if (hadPlus) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  // Bare national number, e.g. 9876543210.
  if (digits.length === 10) {
    // Indian mobile numbers start 6-9. A 10-digit string starting 0-5 is
    // more likely a landline or a mangled cell than a mobile.
    if (!/^[6-9]/.test(digits)) return null;
    return `+${defaultCountryCode}${digits}`;
  }

  // Trunk-prefixed, e.g. 09876543210.
  if (digits.length === 11 && digits.startsWith('0')) {
    const national = digits.slice(1);
    if (!/^[6-9]/.test(national)) return null;
    return `+${defaultCountryCode}${national}`;
  }

  // Country code without a plus, e.g. 919876543210.
  if (digits.length === 12 && digits.startsWith(defaultCountryCode)) {
    return `+${digits}`;
  }

  return null;
}

const LANGUAGE_ALIASES: Record<string, ParentLanguage> = {
  english: 'en-IN',
  en: 'en-IN',
  hindi: 'hi-IN',
  hi: 'hi-IN',
  kannada: 'kn-IN',
  kannad: 'kn-IN',
  kn: 'kn-IN',
  tamil: 'ta-IN',
  ta: 'ta-IN',
  telugu: 'te-IN',
  te: 'te-IN',
  malayalam: 'ml-IN',
  ml: 'ml-IN',
  marathi: 'mr-IN',
  mr: 'mr-IN',
  bengali: 'bn-IN',
  bangla: 'bn-IN',
  bn: 'bn-IN',
  gujarati: 'gu-IN',
  gu: 'gu-IN',
  punjabi: 'pa-IN',
  pa: 'pa-IN',
  odia: 'od-IN',
  oriya: 'od-IN',
  od: 'od-IN',
};

/**
 * Resolves a language as written in a spreadsheet ("Kannada", "kn-IN", "hi")
 * to a Sarvam BCP-47 code. Falls back to English rather than failing the row:
 * the wrong language on a call is recoverable, a dropped parent contact is not.
 */
export function normaliseLanguage(raw: string | null | undefined): ParentLanguage {
  if (!raw) return 'en-IN';
  const trimmed = raw.trim();

  const exact = PARENT_LANGUAGES.find((l) => l.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;

  const key = trimmed.toLowerCase().replace(/[^a-z]/g, '');
  return LANGUAGE_ALIASES[key] ?? 'en-IN';
}

/**
 * Parses the date formats that turn up in Indian college spreadsheets and
 * returns `YYYY-MM-DD`.
 *
 * Day-first is assumed for ambiguous slash/dash dates (`03/04/2026` → 3 April),
 * which matches local convention. Unambiguous ISO input is passed straight
 * through, so `2026-04-03` is never reinterpreted.
 */
export function normaliseDate(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;

  // ISO, already correct.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // DD/MM/YYYY or DD-MM-YYYY (also 2-digit years).
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(trimmed);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // "March 2026" / "Mar-2026" — a monthly attendance sheet. Anchored to the
  // first of the month so records from one sheet share a date.
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ];
  const monthYear = /^([a-z]{3,9})[\s\-/]*(\d{4})$/i.exec(trimmed);
  if (monthYear) {
    const index = monthNames.findIndex((m) => m.startsWith(monthYear[1]!.toLowerCase()));
    if (index !== -1) {
      return `${monthYear[2]}-${String(index + 1).padStart(2, '0')}-01`;
    }
  }

  return fallback;
}

/**
 * Parses a number from a spreadsheet cell, tolerating thousands separators,
 * stray percent signs and whitespace. Returns null for anything that is not a
 * number — including an empty cell, which must become a row error rather than
 * a silent zero.
 */
export function parseNumber(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).trim().replace(/[,%\s]/g, '');
  if (!cleaned) return null;
  // Reject things like "12abc" that Number() would also reject, and "" which
  // Number() would happily turn into 0.
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
