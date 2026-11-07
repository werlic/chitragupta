import { ActionCandidateSchema, type ActionCandidate } from '../types';

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ candidateId: string; field: string; message: string }>;
}

export function validateCandidates(candidates: unknown[]): ValidationResult {
  const errors: ValidationResult['errors'] = [];

  for (let i = 0; i < candidates.length; i++) {
    const result = ActionCandidateSchema.safeParse(candidates[i]);
    if (!result.success) {
      const candidateId = (candidates[i] as any)?.id || `index-${i}`;
      for (const issue of result.error.issues) {
        errors.push({
          candidateId,
          field: issue.path.join('.'),
          message: issue.message,
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
