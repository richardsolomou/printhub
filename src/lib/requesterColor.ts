/** Stable per-person accent derived from the email, tuned for the dark theme. */
export function requesterColor(email: string): string {
  let hash = 0
  for (const char of email) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `hsl(${hash % 360} 45% 65%)`
}
