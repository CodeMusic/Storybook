export type ChapterItem = { id:number; heading:string; synopsis?:string };

export function parseTOC(toc: string): ChapterItem[] {
  // Normalize and strip markdown fences and bold markers
  const cleaned = toc
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1");

  const rawLines = cleaned.split(/\r?\n/).map(s=>s.trim());
  // Keep only lines that look like list items (numbered or bulleted)
  const listLines = rawLines.filter(Boolean).filter(line => /^(\d+[\).]|[•\-*])\s+/.test(line) || /^\d+\s+/.test(line));
  let chapterIndex = 1;
  return listLines.map(line => {
    // Remove leading numbering/bullets
    const withoutPrefix = line.replace(/^\s*(?:\d+[\).]|[•\-*])\s*/, "");
    const body = withoutPrefix.trim();
    const parts = body.split(/[—\-:\u2013]/);
    const heading = (parts[0] || "").trim();
    const synopsis = (parts.slice(1).join("-") || "").trim() || undefined;
    const id = chapterIndex++;
    return { id, heading: heading || `Chapter ${id}`, synopsis };
  });
}

export function buildCoverPromptFromTOC(title: string, toc: string){
  const seed = toc.split(/\r?\n/).filter(Boolean).slice(0,2).join(", ");
  return `${title}: ${seed}. Cozy watercolor, soft light, storybook composition, ancient relic/tech motif.`;
}


