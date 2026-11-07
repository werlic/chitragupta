import { AlertTriangle, ShieldAlert } from 'lucide-react';
import type { InjectionResult, RedactionResult, RuleWarning } from '@/lib/agent/types';

interface WarningBannerProps {
  injectionResult?: InjectionResult;
  redactionResult?: RedactionResult;
  /** Pass [] when the warnings are shown per action card */
  ruleWarnings?: RuleWarning[];
}

const PII_LABEL: Record<string, string> = {
  nik: 'NIK',
  phone: 'nomor HP',
  email: 'email',
  address: 'alamat',
  credit_card: 'nomor kartu',
};

// Input-guard findings, styled per the Lontar "Injeksi / bahaya" and "Peringatan aturan" tokens
export function WarningBanner({ injectionResult, redactionResult, ruleWarnings = [] }: WarningBannerProps) {
  const quarantined = injectionResult?.quarantinedSegments ?? [];
  const hasInjection = !!injectionResult?.detected || quarantined.length > 0;
  const hasPII = !!redactionResult?.detected;
  const hasRuleWarnings = (ruleWarnings?.length ?? 0) > 0;

  // Canvas Review: no banner when the input is clean; rule warnings sit in each action card
  if (!hasInjection && !hasPII && !hasRuleWarnings) return null;

  return (
    <div className="space-y-2">
      {hasInjection &&
        (quarantined.length > 0 ? (
          quarantined.map((s, i) => (
            <div
              key={`${s.segmentId}-${i}`}
              role="note"
              className="flex items-start gap-2.5 rounded-lg bg-destructive-soft px-3 py-2.5 text-[13px] text-destructive"
            >
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                <strong>Instruksi tertanam diabaikan{s.segmentId ? ` (${s.segmentId})` : ''}:</strong> “{s.text}” Baris ini
                dikarantina dan tidak menjadi aksi.
              </span>
            </div>
          ))
        ) : (
          <div role="note" className="flex items-start gap-2.5 rounded-lg bg-destructive-soft px-3 py-2.5 text-[13px] text-destructive">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              <strong>Instruksi tertanam terdeteksi.</strong> Baris tersebut dikarantina dan tidak menjadi aksi.
            </span>
          </div>
        ))}

      {hasPII && (
        <div role="note" className="flex items-start gap-2.5 rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            <strong>Data pribadi disamarkan ({redactionResult!.items.length}):</strong>{' '}
            {Array.from(new Set(redactionResult!.items.map((i) => PII_LABEL[i.type] ?? i.type))).join(', ')}. Sesuai UU PDP No.
            27/2022.
          </span>
        </div>
      )}

      {hasRuleWarnings && (
        <div role="note" className="flex items-start gap-2.5 rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            <strong>{ruleWarnings!.length} peringatan aturan</strong> (libur, salat Jumat, jam kerja, zona waktu). Detail dan
            saran jam ada di kartu aksi masing-masing.
          </span>
        </div>
      )}
    </div>
  );
}
