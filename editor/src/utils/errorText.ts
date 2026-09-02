/**
 * The message to show a user for a failed request.
 *
 * Axios buries FastAPI's `{"detail": ...}` two levels down, and a network
 * failure has no response at all -- so every call site was writing the same
 * three-step fallback by hand, seventeen times across nine files, with
 * slightly different final fallbacks. One copy, one behaviour.
 */
export function errorText(error: unknown, fallback: string): string {
  const e = error as { response?: { data?: { detail?: unknown } }; message?: string } | undefined;
  const detail = e?.response?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (detail) return JSON.stringify(detail);
  return e?.message || fallback;
}
