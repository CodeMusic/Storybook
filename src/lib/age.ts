// Normalizes age range strings to the app's accepted forms.
// If input cannot be parsed, defaults to "16-20".
export function normalizeAgeRange(raw?: string): string
{
  const DEFAULT = "16-20";
  if (!raw || typeof raw !== "string")
  {
    return DEFAULT;
  }
  const text = raw.toString().trim();
  if (!text)
  {
    return DEFAULT;
  }
  // Accept forms like "n-m" with optional spaces/dashes or "n+"
  const plusMatch = text.match(/^\s*(\d{1,3})\s*\+\s*$/);
  if (plusMatch)
  {
    return `${plusMatch[1]}+`;
  }
  const rangeMatch = text.match(/^\s*(\d{1,3})\s*[-–—]\s*(\d{1,3})\s*$/);
  if (rangeMatch)
  {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (!isNaN(start) && !isNaN(end) && end >= start)
    {
      return `${start}-${end}`;
    }
  }
  // Fallback if we cannot parse
  return DEFAULT;
}


