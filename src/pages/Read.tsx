import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { CornerUpLeft, Loader2, Play, Pause, Download } from "lucide-react";
import { expandChapter, expandChapterStream, genImage, exportBook, voiceforge, REGENERATE_BROKEN_IMAGES } from "../services/n8n";
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
  const [chapterLength, setChapterLength] = useState<string>("short");
  const [keypoints, setKeypoints] = useState<string>("");
  const [style, setStyle] = useState<string>("warm, whimsical, gentle-humor");
  const [premise, setPremise] = useState<string>("");
  const proseScale = proseScaleClassForAgeRange(ageRange);
  const headingScale = headingSizeClassForAgeRange(ageRange);
  const [hydrated, setHydrated] = useState<boolean>(false);
  const [influence, setInfluence] = useState<string>("");

  // Streaming state for the active chapter (only on Read page)
  const [streamingHtml, setStreamingHtml] = useState<string>("");
  const [streamingImageUrl, setStreamingImageUrl] = useState<string | null>(null);
  const [streamingChapterId, setStreamingChapterId] = useState<number | null>(null);
  const [streamingChapterHeading, setStreamingChapterHeading] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const STREAMING_KEY = "storyforge.streaming.v1";
  const regenerateTriedRef = useRef<Record<number, boolean>>({});

  // Audio state for chapter narration
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isSynthLoading, setIsSynthLoading] = useState<boolean>(false);
  const [needsGesture, setNeedsGesture] = useState<boolean>(false);
  const [audioCtx, setAudioCtx] = useState<AudioContext | null>(null);
  const [audioReady, setAudioReady] = useState<boolean>(false);
  const [pendingUserPlay, setPendingUserPlay] = useState<boolean>(false);
  const [audioRequested, setAudioRequested] = useState<boolean>(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Incremental markdown renderer that coexists with HTML
  function escapeHtml(unsafe: string): string
  {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function markdownToHtmlIncremental(src: string): string
  {
    const original = decodeEntities(src || "");
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

  // Remove a leading heading tag to avoid duplicate titles (cognitive dissonance prevention)
  function stripFirstHeadingTag(html: string): string
  {
    if (!html || !html.trim()) { return html; }
    // Preserve an optional leading wrapper like words-flash, but drop the first <h1>-<h6>
    const re = /^\s*((?:<div[^>]*class="[^"]*words-flash[^"]*"[^>]*>\s*)?)(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>\s*)/i;
    return html.replace(re, (_m, prefix) => `${prefix}`);
  }

  // Remove a leading textual chapter label like: "Chapter Five: Title ..." → "Title ..."
  function stripLeadingChapterLabel(html: string): string
  {
    if (!html || !html.trim()) { return html; }
    // Match optional words-flash wrapper, optional opening paragraph, then Chapter ...: prefix
    const rePara = /^\s*((?:<div[^>]*class="[^"]*words-flash[^"]*"[^>]*>\s*)?(?:<p[^>]*>\s*)?)\s*Chapter\s+[^:]{1,80}:\s*/i;
    const withoutParaPrefix = html.replace(rePara, (_m, prefix) => `${prefix}`);
    if (withoutParaPrefix !== html) { return withoutParaPrefix; }
    // Fallback: handle raw text without <p>
    const reRaw = /^\s*Chapter\s+[^:]{1,80}:\s*/i;
    return html.replace(reRaw, "");
  }

  // Extract a title from a leading pattern like "Chapter Five: The Escape" in the first heading/paragraph
  function extractChapterTitleFromHtml(html: string): string | null
  {
    if (!html || !html.trim()) { return null; }
    const s = html.toString();
    // Try matching inside an <h1-6> or <p> first
    const reTag = /^\s*(?:<div[^>]*class="[^"]*words-flash[^"]*"[^>]*>\s*)?(?:<h[1-6][^>]*>|<p[^>]*>)\s*Chapter\s+[^:]{1,80}:\s*([^<\n]{1,160})/i;
    const m1 = s.match(reTag);
    if (m1 && m1[1]) { return m1[1].trim(); }
    // Fallback: raw text at beginning
    const reRaw = /^\s*Chapter\s+[^:]{1,80}:\s*([^\n<]{1,160})/i;
    const m2 = s.match(reRaw);
    if (m2 && m2[1]) { return m2[1].trim(); }
    return null;
  }

  function renderStreaming(raw: string): string
  {
    const text = decodeEntities((raw || "").toString());
    if (!text.trim()) { return ""; }
    if (/[<][a-zA-Z!\/?]/.test(text))
    {
      return stripLeadingChapterLabel(stripFirstHeadingTag(coerceHTMLString(text)));
    }
    return stripLeadingChapterLabel(stripFirstHeadingTag(markdownToHtmlIncremental(text)));
  }

  // Decode common HTML entities (handles &quot; in streamed JSON)
  function decodeEntities(input: string): string
  {
    if (!input) { return input; }
    let s = input
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    // Numeric entities
    s = s.replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(parseInt(d, 10)));
    s = s.replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
    return s;
  }

  // Remove agent/tool-call protocol frames like: Scene {"name":"WriteNextChapter", ...}
  function stripAgentProtocol(input: string): string
  {
    if (!input) { return input; }
    let s = decodeEntities(input);
    // Drop leading "Scene" label
    s = s.replace(/^\s*Scene\b[\s:]*/i, '');
    // Attempt to remove JSON tool-call objects
    // Iterate a few times to clean multiple frames
    for (let i = 0; i < 3; i++)
    {
      const match = s.match(/\{[\s\S]*?\}/);
      if (!match) { break; }
      try
      {
        const obj = JSON.parse(match[0]);
        if (obj && typeof obj === 'object' && 'name' in obj && 'parameters' in obj)
        {
          s = s.slice(0, match.index || 0) + s.slice((match.index || 0) + match[0].length);
          continue;
        }
      } catch {}
      break;
    }
    return s;
  }

  // Wrap words in spans for per-word animation
  // Only the latest word should have strong animation (word-new)
  // Earlier words in the same chunk get a subtle cue (word-recent)
  function wrapWords(html: string, newlyAddedWordCount: number, options?: { skipFirstWord?: boolean }): string
  {
    if (!html || !html.trim()) { return html; }
    // Split by HTML tags to only wrap text nodes
    const parts = html.split(/(<[^>]+>)/g);
    let textWordCounter = 0;
    let skippedFirst = false;
    const newCount = Math.max(0, newlyAddedWordCount | 0);
    const wrapped = parts.map(part => {
      if (part.startsWith('<')) { return part; }
      // Split text into words and spaces, preserving punctuation
      return part.replace(/([\w'’]+)(\s*)/g, (_m, w: string, space: string) => {
        textWordCounter++;
        if (!skippedFirst && options?.skipFirstWord)
        {
          skippedFirst = true;
          return `${w}${space}`;
        }
        // Determine recency band for this token relative to the end
        // We treat only the very last word as new, and the preceding up to (newCount-1) as recent
        const clsBase = 'word';
        if (newCount > 0)
        {
          // Compute this token's position among all seen words so far in this text run
          // Since we do not know total upfront for this fragment, we approximate by looking
          // at the trailing window using a running counter and the provided newCount.
          // This function is used on the full html string per frame, so tokens near the end
          // will be wrapped later and receive the recent/new classes.
          // Mark the last token as word-new and the prior ones in the same chunk as word-recent.
          const idxFromEndEstimate = 0; // We'll instead base on modulo by deferring labeling until after pass
        }
        // Fallback: default label; we will re-label using a second pass below
        const cls = clsBase;
        return `<span class="${cls}">${w}<\/span>${space}`;
      });
    }).join('');
    // Second pass: reassign classes to only the last "newCount" words,
    // with the final one as word-new and earlier ones as word-recent.
    if (newCount <= 0) { return wrapped; }
    // Find all word spans and adjust the last window
    const tokens = Array.from(wrapped.matchAll(/<span class=\"word\">([\s\S]*?)<\/span>/g));
    if (tokens.length === 0) { return wrapped; }
    const lastIndex = tokens.length - 1;
    const startRecent = Math.max(0, lastIndex - newCount + 1);
    let replaced = wrapped;
    for (let i = lastIndex; i >= startRecent; i--)
    {
      const m = tokens[i];
      if (!m) { continue; }
      const full = m[0];
      const inner = m[1];
      const cls = (i === lastIndex) ? 'word word-new' : 'word word-recent';
      const updated = `<span class=\"${cls}\">${inner}<\/span>`;
      // Replace the last occurrence to target the correct token even if duplicates exist
      const pos = replaced.lastIndexOf(full);
      if (pos >= 0)
      {
        replaced = replaced.slice(0, pos) + updated + replaced.slice(pos + full.length);
      }
    }
    return replaced;
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
    // If looks like HTML, use as-is (but decode entities once to handle &quot; inside attributes/text)
    if (/[<][a-zA-Z!\/?]/.test(text)) return decodeEntities(text);
    // Fallback: paragraphs with <br/>
    const escapeHtml = (s: string) => s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const decoded = decodeEntities(text);
    const blocks = decoded.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
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
        setChapterLength(data.chapterLength || "short");
        setKeypoints(data.keypoints || "");
        setStyle(data.style || "warm, whimsical, gentle-humor");
        setPremise(data.premise || "");
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
    setHydrated(true);
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
      if (!doExport || !hydrated) return;
      // Require content to be hydrated before exporting to avoid empty files
      const hasScenes = Array.isArray(scenes) && scenes.length > 0;
      if (!hasScenes) return;
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
  }, [doExport, hydrated, scenes.length]);

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
      const context = { title, premise, toc, priorHtml: scenes.map(s=>s.html), ageRange: normAge, lengthHint, genre, keypoints, style, chapterLength };
      const influenceBracket = `[context: genre=${genre}; age=${normAge}; style=${style}; notes=${(keypoints||"").slice(0,120)}]`;

      // Prepare streaming UI state
      setIsStreaming(true);
      setStreamingChapterId(chapterMeta.id);
      setStreamingChapterHeading(chapterMeta.heading);
      setStreamingHtml("");
      setStreamingImageUrl(null);

      // 1) Generate image first; set URL immediately so it appears before text, then preload in background
      let resolvedImageUrlEarly: string | null = null;
      try {
        const imgPrompt = `${title || "Untitled Codex"} (ages ${normAge}): Chapter ${chapterMeta.id} - ${chapterMeta.heading}. Genre ${genre}. Style ${style}.`;
        const img = await genImage(imgPrompt);
        const url = img?.url || null;
        if (url)
        {
          resolvedImageUrlEarly = url;
          // Make the image visible immediately
          setStreamingImageUrl(url);
          // Attempt to ensure the image is actually renderable before we start streaming text
          // Some generators return a URL before pixels are ready; we wait briefly with one retry
          const preloadOnce = () => new Promise<void>((resolve) => {
            try
            {
              const im = new Image();
              try { (im as any).decoding = 'async'; } catch {}
              try { (im as any).loading = 'eager'; } catch {}
              im.onload = () => resolve();
              im.onerror = () => resolve();
              im.src = url;
            }
            catch { resolve(); }
          });
          const preloadWithRetry = async () =>
          {
            await preloadOnce();
            // Small retry to handle transient 404-before-ready cases
            await new Promise(res => setTimeout(res, 200));
            await preloadOnce();
          };
          // Wait up to ~2.5s to give the image a chance to appear first
          await Promise.race([
            preloadWithRetry(),
            new Promise(res => setTimeout(res, 2500))
          ]);
          // Hint the browser to prioritize fetch
          try
          {
            if (typeof document !== 'undefined')
            {
              const link = document.createElement('link');
              link.rel = 'preload';
              (link as any).as = 'image';
              link.href = url;
              document.head.appendChild(link);
              setTimeout(()=>{ try { document.head.removeChild(link); } catch {} }, 15000);
            }
          }
          catch {}
        }
      } catch { resolvedImageUrlEarly = null; }

      // 2) Stream the chapter content and hide spinner on first chunk
      let rawText = "";
      let sawFirstChunk = false;
      let prevWordCount = 0;
      const combinedInfluence = (influence && influence.trim()) ? `${influenceBracket} ${influence.trim()}` : influenceBracket;
      for await (const chunk of expandChapterStream({ context, chapterIndex: idx, influence: combinedInfluence, lengthHint }))
      {
        rawText += stripAgentProtocol(chunk);
        if (!sawFirstChunk && chunk && chunk.trim())
        {
          setLoading(false);
          sawFirstChunk = true;
        }
        const htmlNow = renderStreaming(rawText);
        const plainText = htmlNow.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const totalWords = plainText ? plainText.split(' ').length : 0;
        const newly = Math.max(0, totalWords - prevWordCount);
        const wrapped = wrapWords(htmlNow, newly, { skipFirstWord: false });
        prevWordCount = totalWords;
        setStreamingHtml(wrapped);
        // Snapshot progress so we can recover from refresh
        try {
          if (typeof window !== 'undefined') {
            const snapshot = { chapterId: chapterMeta.id, chapterHeading: chapterMeta.heading, rawText, imageUrl: streamingImageUrl };
            window.localStorage.setItem(STREAMING_KEY, JSON.stringify(snapshot));
          }
        } catch {}
      }

      // Finalize and persist (prefer resolved image, fall back to any streamed URL)
      const finalHtml = (()=>{
        const htmlNow = renderStreaming(rawText);
        // Flash all words briefly
        return `<div class="words-flash">${wrapWords(htmlNow, 0, { skipFirstWord: false })}<\/div>`;
      })();
      const finalImageUrl = resolvedImageUrlEarly || streamingImageUrl;
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
      // Clear influence after it has been used for this generation
      try { setInfluence(""); } catch {}
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

  // Rendered HTML for chapter body
  const displayHtml = useMemo(() =>
  {
    // Streaming: animate only newly added words
    if (isStreaming)
    {
      return streamingHtml;
    }
    // Finalized chapters: DO NOT per-word wrap; keep static, but allow drop cap
    if (activeScene?.html)
    {
      return activeScene.html;
    }
    return "";
  }, [activeScene?.html, isStreaming, streamingHtml]);

  // Compute a display heading: prefer a title extracted from content; avoid duplicated "Chapter" prefixes
  const displayChapterHeading = useMemo(() =>
  {
    const htmlSource = isStreaming ? streamingHtml : (activeScene?.html || "");
    const derived = extractChapterTitleFromHtml(htmlSource);
    const fallback = activeScene ? activeScene.chapterHeading : streamingChapterHeading;
    if (derived && derived.trim()) { return derived.trim(); }
    if ((fallback || "").trim().toLowerCase().startsWith("chapter "))
    {
      // Show just the fallback (e.g., "Chapter Five") without numeric prefix to avoid duplication
      return fallback || "";
    }
    return fallback || "";
  }, [activeScene, streamingChapterHeading, isStreaming, streamingHtml]);

  const [turning, setTurning] = useState<boolean>(false);

  // Initialize and keep a DOM <audio> element with the right attributes
  useEffect(() => {
    const el = audioRef.current;
    if (!el) { return; }
    try { (el as any).crossOrigin = 'anonymous'; } catch {}
    try { el.setAttribute('playsinline', ''); el.setAttribute('webkit-playsinline', ''); } catch {}
    el.preload = 'auto';
    el.onended = () => setIsPlaying(false);
    setAudioEl(el);
  }, []);

  // Cleanup audio on unmount or chapter change
  useEffect(() => {
    return () => {
      try {
        if (audioEl) { audioEl.pause(); }
      } catch {}
      try {
        if (audioUrl && audioUrl.startsWith('blob:')) { URL.revokeObjectURL(audioUrl); }
      } catch {}
      setAudioEl(null);
      setAudioUrl(null);
      setIsPlaying(false);
      setAudioReady(false);
      setPendingUserPlay(false);
      setAudioRequested(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx]);

  async function prepareAudio(autoPlay: boolean)
  {
    const el = audioRef.current;
    setAudioReady(false);
    setNeedsGesture(false);
    if (!el) { return; }
    try { el.pause(); } catch {}
    try { el.removeAttribute('src'); } catch {}
    try { el.load(); } catch {}
    if (!activeScene || !activeScene.html) { setAudioUrl(null); return; }
    try
    {
      setIsSynthLoading(true);
      const plain = (activeScene.html || "").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const { url } = await voiceforge(plain);
      setAudioUrl(url);
      el.src = url;
      const onCanPlayThrough = async () =>
      {
        setAudioReady(true);
        if (autoPlay || pendingUserPlay)
        {
          try { await el.play(); setIsPlaying(true); setNeedsGesture(false); setPendingUserPlay(false); }
          catch { setNeedsGesture(true); }
        }
      };
      el.addEventListener('canplaythrough', onCanPlayThrough, { once: true } as any);
      try { el.load(); } catch {}
    }
    catch (e: any)
    {
      setError(e?.message || 'Audio failed');
    }
    finally
    {
      setIsSynthLoading(false);
    }
  }

  async function handleSpeak()
  {
    if (isSynthLoading) { return; }
    setAudioRequested(true);
    setPendingUserPlay(true);
    await prepareAudio(true);
  }

  // Toggle play/pause; synthesize audio if needed
  async function handlePlayPause()
  {
    try
    {
      if (!activeScene || !activeScene.html) { return; }
      // First interaction: request audio synthesis on demand
      if (!audioRequested)
      {
        await handleSpeak();
        return;
      }
      // If audio is still preparing, remember the user's intent
      if (isSynthLoading && audioEl)
      {
        setPendingUserPlay(true);
        return;
      }

      // Try to unlock audio on iOS/Safari by resuming an AudioContext in a user gesture
      try
      {
        const Ctx: any = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (Ctx)
        {
          const ctx = audioCtx || new Ctx();
          setAudioCtx(ctx);
          if (ctx.state !== 'running') { await ctx.resume().catch(()=>{}); }
        }
      } catch {}

      // If we already have audio and an element, just toggle or request play
      if (audioEl)
      {
        if (isPlaying)
        {
          audioEl.pause();
          setIsPlaying(false);
        }
        else
        {
          if (audioReady)
          {
            try { await audioEl.play(); setIsPlaying(true); setNeedsGesture(false); }
            catch { setNeedsGesture(true); }
          }
          else
          {
            setPendingUserPlay(true);
            try { await audioEl.play(); setIsPlaying(true); setNeedsGesture(false); }
            catch { setNeedsGesture(true); }
          }
        }
        return;
      }
      // Fallback: if for some reason the DOM audio isn't ready, bind it now
      if (audioRef.current)
      {
        setAudioEl(audioRef.current);
        setPendingUserPlay(true);
        try { await audioRef.current.play(); setIsPlaying(true); setNeedsGesture(false); }
        catch { setNeedsGesture(true); setIsPlaying(false); }
      }
    }
    catch (e: any)
    {
      setError(e?.message || 'Audio failed');
    }
  }

  async function handleDownloadAudio()
  {
    try
    {
      if (!audioUrl) { return; }
      const safeTitle = (title || 'Storyforge').toString().replace(/[^a-z0-9\- _\(\)\[\]]+/gi, "_").trim() || 'storybook';
      const chapterLabel = (activeScene ? activeScene.chapterId : streamingChapterId) || 1;
      const fileName = `${safeTitle}-chapter-${chapterLabel}.mp3`;
      // If already a blob/data URL, download directly
      if (audioUrl.startsWith('blob:') || audioUrl.startsWith('data:'))
      {
        const a = document.createElement('a');
        a.href = audioUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }
      // Try to fetch and convert to blob for a reliable download
      try
      {
        const resp = await fetch(audioUrl);
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(()=>{ try { URL.revokeObjectURL(url); } catch {} }, 15000);
        return;
      }
      catch
      {
        // Fallback: open in new tab
        window.open(audioUrl, '_blank');
      }
    }
    catch {}
  }

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
          <h1 className="mt-2 text-2xl font-story-title whitespace-normal break-words">{title || "StoryForge"}</h1>
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
              <div className={`font-story-title ${headingScale} mb-2 text-amber-900 whitespace-normal break-words` }>
                {displayChapterHeading && !/^\s*chapter\s+/i.test(displayChapterHeading)
                  ? <>Chapter {activeScene ? activeScene.chapterId : streamingChapterId}: {displayChapterHeading}</>
                  : <>{displayChapterHeading || `Chapter ${activeScene ? activeScene.chapterId : streamingChapterId}`}</>}
              </div>
              {(activeScene?.imageUrl || streamingImageUrl) && (
                <>
                  <img
                    src={(activeScene?.imageUrl || streamingImageUrl) as string}
                    alt="Scene"
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                    className="w-full h-auto rounded-lg border border-amber-200 mb-2"
                    onError={async ()=>{
                      try {
                        const chapterId = activeScene ? activeScene.chapterId : (streamingChapterId || 0);
                        if (!REGENERATE_BROKEN_IMAGES) { return; }
                        if (!chapterId || regenerateTriedRef.current[chapterId]) { return; }
                        regenerateTriedRef.current[chapterId] = true;
                        const prompt = `${title || "Untitled Codex"} (ages ${normalizeAgeRange(ageRange)}): Chapter ${chapterId} - ${(activeScene ? activeScene.chapterHeading : streamingChapterHeading) || ''}.`;
                        const img = await genImage(prompt);
                        const url = img?.url || null;
                        if (activeScene)
                        {
                          setScenes(prev => prev.map(s => s.chapterId === chapterId ? { ...s, imageUrl: url } : s));
                        }
                        else
                        {
                          setStreamingImageUrl(url);
                        }
                      } catch {}
                    }}
                  />

                  {/* Influence panel: appears under the image to guide the NEXT chapter */}
                  {!!nextChapter && !isStreaming && (
                    <div className="mb-3 max-w-md">
                      <label className="block text-xs font-medium text-amber-900 mb-1">Influence (optional)</label>
                      <textarea
                        value={influence}
                        onChange={(e)=> setInfluence(e.target.value)}
                        rows={3}
                        placeholder="Suggest beats, tone, or details to prime the next chapter"
                        className="w-full rounded-lg border border-amber-200 bg-white/70 backdrop-blur px-3 py-2 text-sm text-amber-900 placeholder:text-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300"
                      />
                      <div className="text-[11px] text-amber-700 mt-1">Used to guide the next chapter. Cleared after use.</div>
                    </div>
                  )}

                  {!!activeScene && !isStreaming && (
                    <div className="flex justify-end mb-3">
                      <button
                        onClick={audioRequested ? handlePlayPause : handleSpeak}
                        disabled={isSynthLoading || isStreaming || !activeScene?.html}
                        title={(isStreaming || !activeScene?.html) ? 'Waiting for generation…' : (isSynthLoading ? 'Preparing…' : (!audioRequested ? 'Speak narration' : (isPlaying ? 'Pause narration' : 'Play narration')))}
                        className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white/70 backdrop-blur px-3 py-1 text-amber-900 hover:bg-amber-100 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                        aria-label={(!audioRequested) ? 'Speak narration' : (isPlaying ? 'Pause narration' : 'Play narration')}
                      >
                        <span className="relative inline-flex h-4 w-4 items-center justify-center">
                          {isSynthLoading && (
                            <>
                              <span className="absolute -inset-1 rounded-full bg-amber-400/50 blur-md animate-ping" aria-hidden="true" />
                              <span className="absolute inset-0 rounded-full bg-amber-500/40 blur-sm animate-pulse" aria-hidden="true" />
                            </>
                          )}
                          {isPlaying
                            ? <Pause className={`h-4 w-4 relative ${isSynthLoading ? 'drop-shadow-[0_0_6px_rgba(245,158,11,0.9)]' : ''}`} />
                            : <Play className={`h-4 w-4 relative ${isSynthLoading ? 'drop-shadow-[0_0_6px_rgba(245,158,11,0.9)]' : ''}`} />}
                        </span>
                        <span className="text-xs">{!audioRequested ? (isSynthLoading ? 'Preparing…' : 'Speak') : (isPlaying ? 'Pause' : (isSynthLoading ? 'Preparing…' : 'Play'))}</span>
                      </button>
                      {audioUrl && (
                        <button
                          onClick={handleDownloadAudio}
                          disabled={isSynthLoading}
                          className="ml-2 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white/70 backdrop-blur px-3 py-1 text-amber-900 hover:bg-amber-100 shadow-sm"
                          aria-label="Download narration audio"
                        >
                          <Download className="h-4 w-4" />
                          <span className="text-xs">Download</span>
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
              {/* If no image was rendered, still provide the play button above the prose */}
              {!activeScene?.imageUrl && !!activeScene && !isStreaming && (
                <>
                  {/* Influence panel when no image is present */}
                  {!!nextChapter && (
                    <div className="mb-3 max-w-md">
                      <label className="block text-xs font-medium text-amber-900 mb-1">Influence (optional)</label>
                      <textarea
                        value={influence}
                        onChange={(e)=> setInfluence(e.target.value)}
                        rows={3}
                        placeholder="Suggest beats, tone, or details to prime the next chapter"
                        className="w-full rounded-lg border border-amber-200 bg-white/70 backdrop-blur px-3 py-2 text-sm text-amber-900 placeholder:text-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300"
                      />
                      <div className="text-[11px] text-amber-700 mt-1">Used to guide the next chapter. Cleared after use.</div>
                    </div>
                  )}
                  <div className="flex justify-end mb-3">
                  <button
                    onClick={audioRequested ? handlePlayPause : handleSpeak}
                    disabled={isSynthLoading || isStreaming || !activeScene?.html}
                    title={(isStreaming || !activeScene?.html) ? 'Waiting for generation…' : (isSynthLoading ? 'Preparing…' : (!audioRequested ? 'Speak narration' : (isPlaying ? 'Pause narration' : 'Play narration')))}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white/70 backdrop-blur px-3 py-1 text-amber-900 hover:bg-amber-100 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    aria-label={(!audioRequested) ? 'Speak narration' : (isPlaying ? 'Pause narration' : 'Play narration')}
                  >
                    <span className="relative inline-flex h-4 w-4 items-center justify-center">
                      {isSynthLoading && (
                        <>
                          <span className="absolute -inset-1 rounded-full bg-amber-400/50 blur-md animate-ping" aria-hidden="true" />
                          <span className="absolute inset-0 rounded-full bg-amber-500/40 blur-sm animate-pulse" aria-hidden="true" />
                        </>
                      )}
                      {isPlaying
                        ? <Pause className={`h-4 w-4 relative ${isSynthLoading ? 'drop-shadow-[0_0_6px_rgba(245,158,11,0.9)]' : ''}`} />
                        : <Play className={`h-4 w-4 relative ${isSynthLoading ? 'drop-shadow-[0_0_6px_rgba(245,158,11,0.9)]' : ''}`} />}
                    </span>
                    <span className="text-xs">{!audioRequested ? (isSynthLoading ? 'Preparing…' : 'Speak') : (isPlaying ? 'Pause' : (isSynthLoading ? 'Preparing…' : 'Play'))}</span>
                  </button>
                  {audioUrl && (
                    <button
                      onClick={handleDownloadAudio}
                      disabled={isSynthLoading}
                      className="ml-2 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white/70 backdrop-blur px-3 py-1 text-amber-900 hover:bg-amber-100 shadow-sm"
                      aria-label="Download narration audio"
                    >
                      <Download className="h-4 w-4" />
                      <span className="text-xs">Download</span>
                    </button>
                  )}
                  </div>
                </>
              )}
              {isStreaming && (
                <div className="flex justify-end mb-3">
                  <button
                    disabled
                    title="Waiting for generation…"
                    className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white/70 backdrop-blur px-3 py-1 text-amber-900 shadow-sm opacity-60 cursor-not-allowed"
                    aria-label="Speak narration (disabled during generation)"
                  >
                    <span className="relative inline-flex h-4 w-4 items-center justify-center">
                      <Play className="h-4 w-4" />
                    </span>
                    <span className="text-xs">Speak</span>
                  </button>
                </div>
              )}
              {/* eslint-disable-next-line react/no-danger */}
              <div className={`${proseScale} prose-amber prose-story dropcap font-story-body max-w-none ${isStreaming ? 'story-hit' : ''}`} dangerouslySetInnerHTML={{ __html: stripLeadingChapterLabel(stripFirstHeadingTag(displayHtml)) }} />
            </div>
          )}
        </div>
      </main>
      {/* Hidden DOM audio element for iOS/Safari reliability */}
      <audio ref={audioRef} style={{ display: 'none' }} />
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


