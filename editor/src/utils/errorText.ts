/**
 * The message to show a user for a failed request.
 *
 * A refusal from the server is an `ApiError` whose message is the server's own
 * `detail`; a network failure is a plain error with a message of its own. One
 * copy of the fallback, instead of one per call site.
 */
export function errorText(error: unknown, fallback: string): string {
  return (error instanceof Error && error.message) || fallback;
}
