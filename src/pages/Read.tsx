import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { CornerUpLeft, Loader2 } from "lucide-react";
import { expandChapter, expandChapterStream, genImage, exportBook } from "../services/n8n";
import { normalizeAgeRange, chapterRangeForAgeRange, proseScaleClassForAgeRange, headingSizeClassForAgeRange } from "../lib/age";

export default function ReadPage()
{
  const router = useRouter();
  const STORAGE_KEY = "storyforge.session.v1";
  const chapterParam = typeof router.query?.chapter === 'string' ? parseInt(router.query.chapter, 10) : undefined;
  const doExport = router.query?.export === '1' || router.query?.export === 'true';

  const [title, setTitle] = useState<string>("");
  const [toc, setToc] = useState<string | null>(null);
  const [chapters, setChapters] = useState<{ id:number; heading:string; synopsis?:string }[]>([]);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [scenes, setScenes] = useState<{ chapterId:number; chapterHeading:string; html:string; imageUrl?:string|null }[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [ageRange, setAgeRange] = useState<string>(normalizeAgeRange("6-8"));
  const [genre, setGenre] = useState<string>("fantasy");
  const [keypoints, setKeypoints] = useState<string>("");
  const [style, setStyle] = useState<string>("warm, whimsical, gentle-humor");
  const proseScale = proseScaleClassForAgeRange(ageRange);
  const headingScale = headingSizeClassForAgeRange(ageRange);

  // Streaming state for the active chapter (only on Read page)
  const [streamingHtml, setStreamingHtml] = useState<string>("");
  const [streamingImageUrl, setStreamingImageUrl] = useState<string | null>(null);
  const [streamingChapterId, setStreamingChapterId] = useState<number | null>(null);
  const [streamingChapterHeading, setStreamingChapterHeading] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const STREAMING_KEY = "storyforge.streaming.v1";

  // Incremental markdown renderer that coexists with HTML
  function escapeHtml(unsafe: string): string
  {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function markdownToHtmlIncremental(src: string): string
  {
    const original = (src || "");
    if (!original.trim()) { return ""; }
    let s = escapeHtml(original);
    // Headings
    s = s.replace(/^######\s+(.*)$/gm, '<h6>$1<\/h6>');
    s = s.replace(/^#####\s+(.*)$/gm, '<h5>$1<\/h5>');
    s = s.replace(/^####\s+(.*)$/gm, '<h4>$1<\/h4>');
    s = s.replace(/^###\s+(.*)$/gm, '<h3>$1<\/h3>');
    s = s.replace(/^##\s+(.*)$/gm, '<h2>$1<\/h2>');
    s = s.replace(/^#\s+(.*)$/gm, '<h1>$1<\/h1>');
    // Bold first (non-greedy to allow incremental close)
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1<\/strong>');
    s = s.replace(/__(.+?)__/g, '<strong>$1<\/strong>');
    // Italic single markers avoiding double markers
    s = s.replace(/(^|[^_])_([^_\n][^_]*)_/g, ($0, p1, p2) => `${p1}<em>${p2}<\/em>`);
    s = s.replace(/(^|[^*])\*([^*\n][^*]*)\*/g, ($0, p1, p2) => `${p1}<em>${p2}<\/em>`);
    // Paragraphs: keep headings as-is
    const blocks = s.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
    const html = blocks.map(block => {
      if (/^<h[1-6]>/.test(block)) { return block; }
      return `<p>${block.replace(/\n/g, '<br/>')}<\/p>`;
    }).join("\n");
    return html;
  }

  function renderStreaming(raw: string): string
  {
    const text = (raw || "").toString();
    if (!text.trim()) { return ""; }
    if (/[<][a-zA-Z!\/?]/.test(text))
    {
      return coerceHTMLString(text);
    }
    return markdownToHtmlIncremental(text);
  }

  function coerceHTMLString(raw: string): string
  {
    const text = (raw || "").toString().trim();
    if (!text) return "";
    // Try JSON parse and drill common fields
    try {
      const obj = JSON.parse(text);
      if (Array.isArray(obj) && obj.length > 0)
      {
        const first: any = obj[0];
        if (typeof first?.html === 'string') return first.html;
        if (typeof first?.output === 'string') return coerceHTMLString(first.output);
      }
      if (typeof obj === 'object' && obj)
      {
        if (typeof (obj as any).html === 'string') return (obj as any).html;
        if (typeof (obj as any).output === 'string') return coerceHTMLString((obj as any).output);
      }
    } catch {}
    // If looks like HTML, use as-is
    if (/[<][a-zA-Z!/?]/.test(text)) return text;
    // Fallback: paragraphs with <br/>
    const escapeHtml = (s: string) => s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
    const blocks = text.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
    return blocks.map(b => `<p>${escapeHtml(b).replace(/\n/g, "<br/>")}</p>`).join("\n");
  }

  // Prevent accidental navigation while streaming and warn on unload
  useEffect(() => {
    const handleRouteStart = () => {
      if (isStreaming) {
        try { router.events.emit('routeChangeError'); } catch {}
        // eslint-disable-next-line no-throw-literal
        throw 'Route change aborted: streaming in progress';
      }
    };
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isStreaming) { return; }
      e.preventDefault();
      // eslint-disable-next-line no-param-reassign
      e.returnValue = '';
    };
    router.events.on('routeChangeStart', handleRouteStart);
    if (typeof window !== 'undefined') { window.addEventListener('beforeunload', handleBeforeUnload as any); }
    return () => {
      router.events.off('routeChangeStart', handleRouteStart);
      if (typeof window !== 'undefined') { window.removeEventListener('beforeunload', handleBeforeUnload as any); }
    };
  }, [isStreaming, router.events]);

  // Restore in-flight stream UI if a snapshot exists (best-effort)
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STREAMING_KEY) : null;
      if (!raw) { return; }
      const snap = JSON.parse(raw);
      if (snap && typeof snap.chapterId === 'number' && !scenes.some(s => s.chapterId === snap.chapterId))
      {
        setIsStreaming(true);
        setStreamingChapterId(snap.chapterId);
        setStreamingChapterHeading(snap.chapterHeading || "");
        setStreamingImageUrl(snap.imageUrl || null);
        setStreamingHtml(renderStreaming(snap.rawText || ""));
        setLoading(false);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load session
  useEffect(()=>{
    try{
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (raw){
        const data = JSON.parse(raw);
        setTitle(data.title ?? "");
        setToc(data.toc || null);
        setChapters(Array.isArray(data.chapters) ? data.chapters : []);
        setCoverUrl(data.coverUrl || null);
        setAgeRange(normalizeAgeRange(data.ageRange || "6-8"));
        setGenre(data.genre || "fantasy");
        setKeypoints(data.keypoints || "");
        setStyle(data.style || "warm, whimsical, gentle-humor");
        const loadedScenes = Array.isArray(data.scenes) ? data.scenes : [];
        // Coerce any legacy/plain scenes into HTML and persist fix
        const coerced = loadedScenes.map((s: any) => ({
          ...s,
          html: coerceHTMLString(s?.html || ""),
        }));
        setScenes(coerced);
        try {
          const updated = { ...data, scenes: coerced };
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        } catch {}
      }
    } catch {}
  }, []);

  // Fallback: use query string title before storage hydration completes
  useEffect(()=>{
    const queryTitle = typeof router.query?.title === 'string' ? router.query.title : '';
    if (!title && queryTitle && queryTitle.trim())
    {
      setTitle(queryTitle);
    }
  }, [router.query?.title, title]);

  // Export full book path
  useEffect(()=>{
    (async ()=>{
      if (!doExport) return;
      try{
        setLoading(true);
        const { downloadUrl, filename } = await exportBook({ scenes, coverUrl, meta: { title, toc, chapters } });
        if (downloadUrl)
        {
          const a = document.createElement("a");
          a.href = downloadUrl;
          a.download = filename || `${title||"storybook"}.html`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          if (downloadUrl.startsWith("blob:")) { URL.revokeObjectURL(downloadUrl); }
        }
      } catch(e:any){ setError(e.message || "Export failed"); }
      finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doExport]);

  const activeIdx = useMemo(()=>{
    if (typeof chapterParam === 'number' && !isNaN(chapterParam))
    {
      const idx = chapters.findIndex(c => c.id === chapterParam);
      return idx >= 0 ? idx : 0;
    }
    return Math.min(scenes.length, Math.max(0, chapters.length ? 0 : 0));   
  }, [chapterParam, chapters, scenes.length]);

  async function ensureChapterGenerated()
  {
    if (!chapters.length) return;
    const idx = activeIdx;
    const chapterMeta = chapters[idx];
    if (!chapterMeta) return;
    // If this specific chapter already has a generated scene, do nothing
    if (scenes.some(s => s.chapterId === chapterMeta.id)) return;
    try{
      setLoading(true); setError(null);
      const normAge = normalizeAgeRange(ageRange);
      const lengthHint = chapterRangeForAgeRange(normAge);
      const context = { title, toc, priorHtml: scenes.map(s=>s.html), ageRange: normAge, lengthHint, genre, keypoints, style };
      const influenceBracket = `[context: genre=${genre}; age=${normAge}; style=${style}; notes=${(keypoints||"").slice(0,120)}]`;

      // Prepare streaming UI state
      setIsStreaming(true);
      setStreamingChapterId(chapterMeta.id);
      setStreamingChapterHeading(chapterMeta.heading);
      setStreamingHtml("");
      setStreamingImageUrl(null);

      // 1) Kick off image generation first, but don't block streaming
      const imagePromise: Promise<string | null> = (async ()=>{
        try {
          const imgPrompt = `${title || "Untitled Codex"} (ages ${normAge}): Chapter ${chapterMeta.id} - ${chapterMeta.heading}. Genre ${genre}. Style ${style}.`;
          const img = await genImage(imgPrompt);
          if (img?.url) { setStreamingImageUrl(img.url); }
          return img?.url || null;
        } catch { return null; }
      })();

      // 2) Stream the chapter content and hide spinner on first chunk
      let rawText = "";
      let sawFirstChunk = false;
      for await (const chunk of expandChapterStream({ context, chapterIndex: idx, influence: influenceBracket }))
      {
        rawText += chunk;
        if (!sawFirstChunk && chunk && chunk.trim())
        {
          setLoading(false);
          sawFirstChunk = true;
        }
        setStreamingHtml(renderStreaming(rawText));
        // Snapshot progress so we can recover from refresh
        try {
          if (typeof window !== 'undefined') {
            const snapshot = { chapterId: chapterMeta.id, chapterHeading: chapterMeta.heading, rawText, imageUrl: streamingImageUrl };
            window.localStorage.setItem(STREAMING_KEY, JSON.stringify(snapshot));
          }
        } catch {}
      }

      // Finalize and persist (prefer resolved image, fall back to any streamed URL)
      const finalHtml = renderStreaming(rawText);
      let resolvedImageUrl: string | null = null;
      try { resolvedImageUrl = await imagePromise; } catch { resolvedImageUrl = null; }
      const finalImageUrl = resolvedImageUrl || streamingImageUrl;
      const next = [...scenes, { chapterId: chapterMeta.id, chapterHeading: chapterMeta.heading, html: finalHtml, imageUrl: finalImageUrl }];
      setScenes(next);
      try{
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : {};
        const updated = { ...data, scenes: next };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      // Clear streaming snapshot
      try { if (typeof window !== 'undefined') { window.localStorage.removeItem(STREAMING_KEY); } } catch {}
    } catch(e:any){ setError(e.message || "Chapter failed"); }
    finally {
      setIsStreaming(false);
      setStreamingChapterId(null);
      setStreamingChapterHeading("");
      setStreamingHtml("");
      // Keep streaming image until scene image is present to avoid flicker
      if (loading) { setLoading(false); }
    }
  }

  useEffect(()=>{ ensureChapterGenerated();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, chapters.length]);

  const activeScene = useMemo(()=>{
    if (typeof chapterParam === 'number' && !isNaN(chapterParam))
    {
      const found = scenes.find(s => s.chapterId === chapterParam);
      if (found) return found;
    }
    return scenes[activeIdx];
  }, [scenes, activeIdx, chapterParam]);

  const prevChapter = useMemo(()=>{
    if (!chapters.length) return undefined;
    const prevIdx = Math.max(0, activeIdx - 1);
    if (prevIdx === activeIdx) return undefined;
    return chapters[prevIdx];
  }, [chapters, activeIdx]);

  const nextChapter = useMemo(()=>{
    if (!chapters.length) return undefined;
    const nextIdx = Math.min(chapters.length - 1, activeIdx + 1);
    if (nextIdx === activeIdx) return undefined;
    return chapters[nextIdx];
  }, [chapters, activeIdx]);

  const [turning, setTurning] = useState<boolean>(false);

  async function navigateWithTurn(nextQuery: any)
  {
    try {
      setTurning(true);
      await new Promise(res => setTimeout(res, 460));
    } finally {
      setTurning(false);
      router.push({ pathname: '/Read', query: nextQuery });
    }
  }

  return (
    <div className={`min-h-screen text-amber-950 font-story-body ${turning ? 'is-turning' : ''} page-turning`}>
      <header className="relative">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <button onClick={()=>router.push('/Outline')} className="inline-flex items-center gap-2 text-amber-900 hover:underline">
            <CornerUpLeft className="h-4 w-4" /> Back to outline
          </button>
          <h1 className="mt-2 text-2xl font-story-title">{title || "Untitled Codex"}</h1>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-32">
        <div className="rounded-2xl border border-amber-300 bg-amber-50/70 p-4 min-h-[240px] relative page">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-amber-100/60 backdrop-blur-sm">
              <div className="flex items-center gap-3 text-amber-900">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Engraving chapter…</span>
              </div>
            </div>
          )}
          {error && <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-800">{error}</div>}
          {(activeScene || isStreaming) && (
            <div>
              <div className={`font-story-title ${headingScale} mb-2`}>
                Chapter {activeScene ? activeScene.chapterId : streamingChapterId}: {activeScene ? activeScene.chapterHeading : streamingChapterHeading}
              </div>
              {(activeScene?.imageUrl || streamingImageUrl) && (
                <img src={(activeScene?.imageUrl || streamingImageUrl) as string} alt="Scene" className="w-full h-auto rounded-lg border border-amber-200 mb-3" />
              )}
              {/* eslint-disable-next-line react/no-danger */}
              <div className={`${proseScale} prose-amber prose-story dropcap max-w-none ${isStreaming ? 'story-hit' : ''}`} dangerouslySetInnerHTML={{ __html: activeScene ? activeScene.html : streamingHtml }} />
            </div>
          )}
        </div>
      </main>
      {/* Bottom navigation for chapter flow */}
      {!loading && (
        <div className="fixed bottom-0 left-0 right-0 z-20">
          <div className="mx-auto max-w-3xl px-4 pb-4">
            <div className="rounded-2xl border border-amber-300 bg-amber-50/90 backdrop-blur px-3 py-3 shadow-lg flex items-center justify-between gap-3">
              <button
                onClick={()=> router.push('/Outline')}
                className="text-sm underline text-amber-900"
              >
                Back to outline
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={()=>{
                    if (!prevChapter) return;
                    navigateWithTurn({ chapter: prevChapter.id, title: (title || 'Untitled Codex') });
                  }}
                  disabled={!prevChapter}
                  className={`rounded-xl border px-4 py-2 text-sm ${!prevChapter? 'opacity-50 cursor-not-allowed' : 'bg-white hover:bg-amber-100'}`}
                >
                  {prevChapter ? `Previous: Chapter ${prevChapter.id}` : 'Previous'}
                </button>
                {chapters.length>0 && scenes.length >= chapters.length ? (
                  <>
                    <button
                      onClick={()=> router.push('/Outline')}
                      className="rounded-xl border px-4 py-2 text-sm bg-white hover:bg-amber-100"
                    >
                      Return to table of contents
                    </button>
                    <button
                      onClick={()=> router.push('/Read?export=1')}
                      className="rounded-xl bg-amber-600 text-white px-4 py-2 text-sm hover:bg-amber-700"
                    >
                      Export Book
                    </button>
                  </>
                ) : (
                  <button
                    onClick={()=>{
                      if (!nextChapter) return;
                      navigateWithTurn({ chapter: nextChapter.id, title: (title || 'Untitled Codex') });
                    }}
                    disabled={!nextChapter}
                    className={`rounded-xl bg-amber-600 text-white px-4 py-2 text-sm hover:bg-amber-700 ${!nextChapter ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {nextChapter ? `Next: Chapter ${nextChapter.id}` : 'Next'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


