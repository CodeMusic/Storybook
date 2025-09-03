// Normalizes age range strings to canonical buckets.
// If input cannot be parsed, defaults to the cognitive-middle bucket "6-8".
export function normalizeAgeRange(raw?: string): string
{
  const DEFAULT = "6-8";

  type AgeBin = { label: string; min: number; max: number; isPlus?: boolean };

  // Canonical bins used across the UI. Note: some overlap is intentional for UX affordances.
  const CANONICAL_BINS: AgeBin[] = [
    { label: "1-3", min: 1, max: 3 },
    { label: "4-8", min: 4, max: 8 },
    { label: "6-8", min: 6, max: 8 },
    { label: "9-15", min: 9, max: 15 },
    { label: "16-20", min: 16, max: 20 },
    { label: "21-25", min: 21, max: 25 },
    { label: "25+", min: 25, max: Number.POSITIVE_INFINITY, isPlus: true }
  ];

  function isCanonicalLabel(label: string): boolean
  {
    return CANONICAL_BINS.some(b => b.label === label);
  }

  function chooseBinByPoint(age: number): string
  {
    if (isNaN(age) || age <= 0)
    {
      return DEFAULT;
    }
    // If above or equal to 25, prefer the terminal plus bin
    if (age >= 25)
    {
      return "25+";
    }
    // Prefer the bin whose midpoint is closest to the age
    let best: { label: string; distance: number } | null = null;
    for (const bin of CANONICAL_BINS)
    {
      if (bin.isPlus) { continue; }
      const midpoint = (bin.min + bin.max) / 2;
      const distance = Math.abs(midpoint - age);
      if (!best || distance < best.distance)
      {
        best = { label: bin.label, distance };
      }
    }
    return best ? best.label : DEFAULT;
  }

  function chooseBinByRange(a: number, b: number): string
  {
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    if (isNaN(start) || isNaN(end) || start <= 0)
    {
      return DEFAULT;
    }
    // If it is an open-ended adult range, map to the terminal bin
    if (end >= 25)
    {
      return "25+";
    }
    const midpoint = (start + end) / 2;
    return chooseBinByPoint(midpoint);
  }

  if (!raw || typeof raw !== "string")
  {
    return DEFAULT;
  }

  const text = raw.toString().trim();
  if (!text)
  {
    return DEFAULT;
  }

  // If already canonical, pass-through
  if (isCanonicalLabel(text))
  {
    return text;
  }

  const lower = text.toLowerCase();

  // Semantic heuristics (psychological framing):
  if (/(toddler|infant|baby)/.test(lower))
  {
    return "1-3";
  }
  if (/(kid|child|children|elementary|grade school)/.test(lower))
  {
    return "6-8";
  }
  if (/(teen|pre-?teen|middle school)/.test(lower))
  {
    return "16-20";
  }
  if (/(adult|grown|mature)/.test(lower))
  {
    return "21-25";
  }

  // Numeric forms: "n+"
  const plusMatch = lower.match(/\b(\d{1,3})\s*\+\b/);
  if (plusMatch)
  {
    const n = parseInt(plusMatch[1], 10);
    if (!isNaN(n))
    {
      if (n >= 25) { return "25+"; }
      return chooseBinByPoint(n);
    }
  }

  // Numeric ranges: "n-m" with various dashes or with words like "to"
  const wordRange = lower.match(/\b(\d{1,3})\s*(?:[-–—]|to|through|–)\s*(\d{1,3})\b/);
  if (wordRange)
  {
    const a = parseInt(wordRange[1], 10);
    const b = parseInt(wordRange[2], 10);
    if (!isNaN(a) && !isNaN(b))
    {
      return chooseBinByRange(a, b);
    }
  }

  // Single number: choose a containing or nearest bin
  const numOnly = lower.match(/\b(\d{1,3})\b/);
  if (numOnly)
  {
    const n = parseInt(numOnly[1], 10);
    if (!isNaN(n))
    {
      return chooseBinByPoint(n);
    }
  }

  // Final fallback
  return DEFAULT;
}


// Derive numeric min/max from a canonical ageRange like "1-3", "6-8", or "25+"
export function parseAgeRangeToMinMax(ageRange: string): { ageMin?: number; ageMax?: number }
{
  const norm = normalizeAgeRange(ageRange);
  if (/^\d{1,3}\+$/.test(norm))
  {
    const n = parseInt(norm.replace(/\D/g, ""), 10);
    return { ageMin: isNaN(n) ? undefined : n, ageMax: undefined };
  }
  const m = norm.match(/^(\d{1,3})-(\d{1,3})$/);
  if (m)
  {
    const ageMin = parseInt(m[1], 10);
    const ageMax = parseInt(m[2], 10);
    return { ageMin: isNaN(ageMin) ? undefined : ageMin, ageMax: isNaN(ageMax) ? undefined : ageMax };
  }
  return {};
}

export type ChapterRangeHint = { range: [number, number]; label: string };

// Cognitive load mapping: younger → fewer words per chapter
export function chapterRangeForAge(ageMin?: number, ageMax?: number): ChapterRangeHint
{
  if (ageMin !== undefined && ageMax !== undefined)
  {
    if (ageMax <= 3) { return { range: [50, 150], label: "1–3" }; }
    if (ageMin >= 4 && ageMax <= 8) { return { range: [500, 1000], label: "4–8" }; }
    if (ageMin >= 9 && ageMax <= 15) { return { range: [1500, 3000], label: "9–15" }; }
    if (ageMin >= 16 && ageMax <= 20) { return { range: [2500, 4000], label: "16–20" }; }
    if (ageMin >= 21 && ageMax <= 25) { return { range: [3000, 5000], label: "21–25" }; }
    if (ageMin >= 26 || ageMax >= 26) { return { range: [3000, 6000], label: "25+" }; }
  }
  return { range: [3000, 5000], label: "default-adult" };
}

export function chapterRangeForAgeRange(ageRange: string): ChapterRangeHint
{
  const { ageMin, ageMax } = parseAgeRangeToMinMax(ageRange);
  return chapterRangeForAge(ageMin, ageMax);
}

// Typography scaling driven by developmental stage
export function proseScaleClassForAgeRange(ageRange: string): string
{
  const { ageMin, ageMax } = parseAgeRangeToMinMax(ageRange);
  if (ageMax !== undefined && ageMax <= 3)
  {
    return "prose-xl md:prose-2xl";
  }
  if (ageMin !== undefined && ageMax !== undefined && ageMin >= 4 && ageMax <= 8)
  {
    return "prose-lg md:prose-xl";
  }
  // Default adults: keep body comfortably large
  return "prose-lg md:prose-xl";
}

export function headingSizeClassForAgeRange(ageRange: string): string
{
  const { ageMin, ageMax } = parseAgeRangeToMinMax(ageRange);
  if (ageMax !== undefined && ageMax <= 3)
  {
    return "text-2xl md:text-3xl";
  }
  if (ageMin !== undefined && ageMax !== undefined && ageMin >= 4 && ageMax <= 8)
  {
    return "text-xl md:text-2xl";
  }
  // Default adults: a bit larger for readability
  return "text-xl md:text-2xl";
}

