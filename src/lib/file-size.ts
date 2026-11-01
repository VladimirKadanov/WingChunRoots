// The size of a file in words for the evidence lists (milestone M10a): kB below 1 MB, MB with one
// decimal above. A plain module, so Server Components and the evidence field share it.

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}
