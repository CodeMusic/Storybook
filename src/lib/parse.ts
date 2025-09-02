export type ChapterItem = { id:number; heading:string; synopsis?:string };

export function parseTOC(toc: string): ChapterItem[]
{
  // Normalize and strip markdown fences and bold markers
  const cleaned = toc
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1");

  const lines = cleaned.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

  const chapters: ChapterItem[] = [];
  let idCounter = 1;

  function pushChapter(rawHeading: string, inlineSynopsis?: string)
  {
    // Remove markdown heading markers
    let headingCore = rawHeading.replace(/^#{1,6}\s+/, "").trim();
    // Drop leading "Chapter N:" style labels from the heading for clarity
    headingCore = headingCore.replace(/^(?:Chapter|Ch\.?|C)\s*\d+\s*[:.\-]\s*/i, "").trim();
    const heading = headingCore || `Chapter ${idCounter}`;
    const synopsis = (inlineSynopsis || "").trim() || undefined;
    chapters.push({ id: idCounter++, heading, synopsis });
  }

  for (let i = 0; i < lines.length; i++)
  {
    const line = lines[i];

    // 1) Numbered or bulleted list formats
    const listMatch = line.match(/^\s*(?:\d+[\).]|[•\-*]|\d+\s+)\s*(.*)$/);
    if (listMatch)
    {
      const body = listMatch[1].trim();
      // Split heading and synopsis on common separators (em dash, en dash, hyphen, colon)
      const parts = body.split(/[—–\-:]\s+/);
      const headingPart = (parts[0] || "").replace(/^(?:Chapter|Ch\.?|C)\s*\d+\s*[:.\-]\s*/i, "").trim();
      const synopsisPart = (parts.slice(1).join(" - ") || "").trim();
      pushChapter(headingPart, synopsisPart);
      continue;
    }

    // 2) Markdown headings like: ## Chapter 1: Title
    const mdHeading = line.match(/^#{1,6}\s+(.*)$/);
    if (mdHeading)
    {
      // Ignore a top-level TOC heading line
      if (/table of contents/i.test(mdHeading[1])) { continue; }
      // If the next non-empty line looks like a paragraph (not another heading or list), treat as synopsis
      const next = lines[i + 1];
      const nextLooksLikeSynopsis = next && !/^#{1,6}\s+/.test(next) && !/^\s*(?:\d+[\).]|[•\-*])\s+/.test(next);
      pushChapter(mdHeading[1], nextLooksLikeSynopsis ? next : undefined);
      if (nextLooksLikeSynopsis) { i++; }
      continue;
    }

    // 3) Plain chapter lines like: Chapter 3: Title
    const chapterLine = line.match(/^(?:Chapter|Ch\.?|C)\s*\d+\s*[:.\-]\s*(.*)$/i);
    if (chapterLine)
    {
      const next = lines[i + 1];
      const nextLooksLikeSynopsis = next && !/^(?:Chapter|Ch\.?|C)\s*\d+\s*[:.\-]\s*/i.test(next) && !/^#{1,6}\s+/.test(next) && !/^\s*(?:\d+[\).]|[•\-*])\s+/.test(next);
      pushChapter(chapterLine[1], nextLooksLikeSynopsis ? next : undefined);
      if (nextLooksLikeSynopsis) { i++; }
      continue;
    }
  }

  // Fallback: plain-title list (e.g., lines like "The Magic Book  ")
  if (chapters.length === 0)
  {
    const titleOnly = lines
      .map(s => s.replace(/\s{2,}$/, "").trim()) // remove trailing markdown linebreak spaces
      .filter(Boolean)
      .filter(s => !/^table of contents$/i.test(s));

    if (titleOnly.length >= 2)
    {
      for (const title of titleOnly)
      {
        pushChapter(title);
      }
    }
  }

  return chapters;
}

export function buildCoverPromptFromTOC(title: string, toc: string){
  const seed = toc.split(/\r?\n/).filter(Boolean).slice(0,2).join(", ");
  return `${title}: ${seed}. Cozy watercolor, soft light, storybook composition, ancient relic/tech motif.`;
}


