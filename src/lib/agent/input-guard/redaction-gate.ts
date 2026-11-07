import { RedactionResultSchema, type RedactionResult } from '../types';

const PII_PATTERNS: { type: 'nik' | 'phone' | 'email' | 'address' | 'credit_card'; regex: RegExp; redactWith: string }[] = [
  { type: 'nik', regex: /\b\d{16}\b/g, redactWith: '[NIK-REDACTED]' },
  { type: 'phone', regex: /(\+62|0)[-\s]?\d{3}[-\s]?\d{3,4}[-\s]?\d{3,4}/g, redactWith: '[PHONE-REDACTED]' },
  { type: 'email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, redactWith: '[EMAIL-REDACTED]' },
  { type: 'credit_card', regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, redactWith: '[CARD-REDACTED]' },
];

export function detectPII(text: string): RedactionResult {
  const items: RedactionResult['items'] = [];
  let cleanedText = text;

  for (const { type, regex, redactWith } of PII_PATTERNS) {
    let match;
    const pattern = new RegExp(regex.source, regex.flags);
    while ((match = pattern.exec(text)) !== null) {
      items.push({
        type,
        original: match[0],
        redacted: redactWith,
        position: match.index,
      });
    }
    cleanedText = cleanedText.replace(regex, redactWith);
  }

  const result: RedactionResult = {
    detected: items.length > 0,
    items,
    cleanedText,
  };

  return RedactionResultSchema.parse(result);
}

export function redactPII(text: string): string {
  return detectPII(text).cleanedText;
}
