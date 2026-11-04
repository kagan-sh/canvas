/** One line for a person: the message of an Error, or the value as text. */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
