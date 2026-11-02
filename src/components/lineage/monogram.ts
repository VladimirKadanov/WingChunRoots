// The monogram of a person (plan §4.8): the first letters of the first and the last word of the
// Latin name. The fallback of every person picture when there is no profile photo (M14).

export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1]![0]! : '';
  return (first + last).toUpperCase();
}
