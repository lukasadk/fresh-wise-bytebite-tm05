export type ExpiryPriorityFields = {
  estimatedExpiryDate: string | null;
  expiryEstimateDays: number | null;
  expiryEstimateBasis: string | null;
};

/** A visible printed expiry is authoritative; estimation is fallback-only. */
export function preferPrintedExpiry(
  printedExpiryDate: string | null,
  estimatedExpiryDate: string | null,
  expiryEstimateDays: number | null,
  expiryEstimateBasis: string | null,
): ExpiryPriorityFields {
  if (printedExpiryDate) {
    return {
      estimatedExpiryDate: null,
      expiryEstimateDays: null,
      expiryEstimateBasis: null,
    };
  }
  return { estimatedExpiryDate, expiryEstimateDays, expiryEstimateBasis };
}
