import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { CornerUpLeft, Loader2 } from "lucide-react";
import { expandChapter, genImage, exportBook } from "../services/n8n";

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
        const { downloadUrl } = await exportBook({ htmlPages: scenes.map(s=>s.html), coverUrl, meta: { title, toc, chapters } });
        if (downloadUrl) { window.open(downloadUrl, "_blank"); }
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
      const context = { title, toc, priorHtml: scenes.map(s=>s.html) };
      const { html } = await expandChapter({ context, chapterIndex: idx });
      let imageUrl: string | null = null;
      try { const img = await genImage(`${title}: ${chapterMeta.heading}. ${html.slice(0,180)}...`); imageUrl = img.url; } catch {}
      const next = [...scenes, { chapterId: chapterMeta.id, chapterHeading: chapterMeta.heading, html, imageUrl }];
      setScenes(next);
      // persist
      try{
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : {};
        const updated = { ...data, scenes: next };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
    } catch(e:any){ setError(e.message || "Chapter failed"); }
    finally { setLoading(false); }
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

  return (
    <div className="min-h-screen text-amber-950">
      <header className="relative">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <button onClick={()=>router.push('/Outline')} className="inline-flex items-center gap-2 text-amber-900 hover:underline">
            <CornerUpLeft className="h-4 w-4" /> Back to outline
          </button>
          <h1 className="mt-2 text-2xl font-serif">{title || "Untitled Codex"}</h1>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-32">
        <div className="rounded-2xl border border-amber-300 bg-amber-50/70 p-4 min-h-[240px] relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-amber-100/60 backdrop-blur-sm">
              <div className="flex items-center gap-3 text-amber-900">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Engraving chapter…</span>
              </div>
            </div>
          )}
          {error && <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-800">{error}</div>}
          {activeScene && (
            <div>
              <div className="font-serif text-xl mb-2">Chapter {activeScene.chapterId}: {activeScene.chapterHeading}</div>
              {activeScene.imageUrl && <img src={activeScene.imageUrl} alt="Scene" className="w-full h-auto rounded-lg border border-amber-200 mb-3" />}
              {/* eslint-disable-next-line react/no-danger */}
              <div className="prose prose-amber max-w-none" dangerouslySetInnerHTML={{ __html: activeScene.html }} />
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
                    router.push({ pathname: '/Read', query: { chapter: prevChapter.id, title: (title || 'Untitled Codex') } });
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
                      router.push({ pathname: '/Read', query: { chapter: nextChapter.id, title: (title || 'Untitled Codex') } });
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


