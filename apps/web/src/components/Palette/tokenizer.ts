export const MAX_INPUT_CHARS = 500;

const SUFFIX_RULES: [RegExp, string][] = [
  [/ing$/,  ""],  // switching → switch
  [/ed$/,   ""],  // forked → fork
  [/er$/,   ""],  // switcher → switch
  [/s$/,    ""],  // rooms → room, creates → create
];

export function stem(token: string): string {
  for (const [pattern, replacement] of SUFFIX_RULES) {
    const stemmed = token.replace(pattern, replacement);
    // Only apply stem if result is at least 3 chars (prevents "is" → "i")
    if (stemmed.length >= 3 && stemmed !== token) return stemmed;
  }
  return token;
}

export function tokenize(input: string): string[] {
  const clamped = input.slice(0, MAX_INPUT_CHARS);
  return clamped.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

export function tokenizeWithStems(input: string): { raw: string[]; stems: string[] } {
  const raw = tokenize(input);
  const stems = raw.map(stem);
  return { raw, stems };
}

export function includesAny(
  raw: string[],
  stems: string[],
  words: readonly string[]
): boolean {
  return words.some((w) => raw.includes(w) || stems.includes(w));
}
