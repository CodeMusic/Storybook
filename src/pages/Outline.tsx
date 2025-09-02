import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { motion } from "framer-motion";
import { Book, Loader2 } from "lucide-react";
import { CoverCard } from "../components/CoverCard";
import { parseTOC, ChapterItem } from "../lib/parse";
import { seedStory, ENDPOINTS } from "../services/n8n";
import { normalizeAgeRange } from "../lib/age";

export default function OutlinePage()
{
  const router = useRouter();
  const STORAGE_KEY = "storyforge.session.v1";
  const SEED_LOCK_KEY = "storyforge.seed.lock.v1";
  const [title, setTitle] = useState<string>("");
  const [premise, setPremise] = useState<string>("");
  const [ageRange, setAgeRange] = useState<string>(normalizeAgeRange("6-8"));
  const [genre, setGenre] = useState<string>("fantasy");
  const [chaptersTarget, setChaptersTarget] = useState<number>(8);
  const [keypoints, setKeypoints] = useState<string>("");
  const [style, setStyle] = useState<string>("warm, whimsical, gentle-humor");
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [toc, setToc] = useState<string | null>(null);
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [generatedIds, setGeneratedIds] = useState<number[]>([]);
  const [hydrated, setHydrated] = useState<boolean>(false);
  const [reseedTick, setReseedTick] = useState<number>(0);
  const isSeedingRef = useRef<boolean>(false);

  // Cognitive control: ensure chapter count matches the user's intention
  function enforceChapterCount(list: ChapterItem[], target: number): ChapterItem[]
  {
    const safeTarget = Math.max(1, Math.floor(target || 0));
    const trimmed = list.slice(0, safeTarget).map((ch, i) => ({ ...ch, id: i + 1 }));
    if (trimmed.length === safeTarget)
    {
      return trimmed;
    }
    const additions: ChapterItem[] = [];
    for (let i = trimmed.length; i < safeTarget; i++)
    {
      additions.push({ id: i + 1, heading: `Chapter ${i + 1}`, synopsis: undefined });
    }
    return [...trimmed, ...additions];
  }

  useEffect(() =>
  {
    // Load session prepared in Storyforge
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (raw)
      {
        const data = JSON.parse(raw);
        const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        const forceReseed = urlParams?.get('reseed') === '1';
        // Sanitize corrupted premise but keep the rest of the session
        if (data.premise && data.premise.includes("Cannot access uninitialized variable"))
        {
          console.log('DEBUG: Sanitizing corrupted premise in localStorage');
          data.premise = "";
          try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
        }
        setTitle(data.title ?? "");
        setPremise(data.premise || "");
        setAgeRange(normalizeAgeRange(data.ageRange || "6-8"));
        setGenre(data.genre || "fantasy");
        setChaptersTarget(typeof data.chaptersTarget === 'number' ? data.chaptersTarget : 8);
        setKeypoints(data.keypoints || "");
        setStyle(data.style || "warm, whimsical, gentle-humor");
        setCoverUrl(data.coverUrl || null);
        // If forced reseed, ignore cached toc/chapters so UI starts clean
        if (forceReseed)
        {
          setToc(null);
          setChapters([]);
          // Purge prior salience notes to prevent leakage into the new outline
          setKeypoints("");
          try {
            const updated = { ...data, toc: null, chapters: [], seedSignature: undefined, keypoints: "" };
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
          } catch {}
        }
        else
        {
          setToc(data.toc || null);
          setChapters(Array.isArray(data.chapters) ? data.chapters : []);
        }
        try {
          const scenes = Array.isArray(data.scenes) ? data.scenes : [];
          const done = scenes.map((s: any) => s?.chapterId).filter((n: any) => typeof n === 'number');
          setGeneratedIds(done);
        } catch {}
      }
    } catch (e) {
      console.error('DEBUG Outline: localStorage error =', e);
    }
    finally { setHydrated(true); }
  }, []);

  useEffect(() =>
  {
    (async () => {
      try {
        console.log('DEBUG Outline useEffect: hydrated =', hydrated, 'toc =', toc);
        if (!hydrated) { return; }
        // Detect seed changes to force reseeding BEFORE any attempt to reuse an existing TOC
        const currentSignature = JSON.stringify({ title, premise, ageRange: normalizeAgeRange(ageRange), genre, chaptersTarget, keypoints, style });
        try {
          const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
          const data = raw ? JSON.parse(raw) : {};
          const storedSignature = data.seedSignature;
          if (storedSignature !== currentSignature)
          {
            const updated = { ...data, seedSignature: currentSignature, toc: null, chapters: [] };
            try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
            setToc(null);
            setChapters([]);
            // Do not return here; proceed to seeding immediately with the fresh signature
          }
        } catch {}
        // If URL explicitly requests reseed, force it once
        const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        const forceReseed = urlParams?.get('reseed') === '1';
        // If we already have a TOC but chapters are empty, normalize and parse without reseeding
        if (!forceReseed && toc && reseedTick === 0 && chapters.length === 0)
        {
          const normalized = (toc || "")
            .replace(/```[\s\S]*?```/g, "")
            .replace(/\*\*(.*?)\*\*/g, "$1")
            .replace(/^[^\n]*Table of Contents[^\n]*\n?/i, "")
            .replace(/^Based on[\s\S]*?:\n+/i, "");
          const parsedRaw = parseTOC(normalized);
          const parsed = enforceChapterCount(parsedRaw, chaptersTarget);
          setToc(normalized);
          setChapters(parsed);
          try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            const data = raw ? JSON.parse(raw) : {};
            const updated = { ...data, toc: normalized, chapters: parsed };
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
          } catch {}
          return;
        }
        // Do not reseed if we already have a TOC unless explicitly retried or forced by URL
        if (!forceReseed && toc && reseedTick === 0) { return; }
        // Protect against re-entrancy
        if (isSeedingRef.current) { return; }
        // Prevent duplicate calls caused by rapid re-renders by using a session-level lock keyed by signature
        try {
          const lock = typeof window !== 'undefined' ? window.sessionStorage.getItem(SEED_LOCK_KEY) : null;
          if (!forceReseed && reseedTick === 0 && lock === currentSignature)
          {
            console.log('DEBUG Outline: Seeding locked for signature, skipping duplicate call');
            return;
          }
        } catch {}
        // Sanitize inputs to avoid false negatives due to prior corruption
        const corruptedToken = "Cannot access uninitialized variable";
        const titleSafe = (title && !title.includes(corruptedToken)) ? title : "";
        const premiseSafe = (premise && !premise.includes(corruptedToken)) ? premise : "";
        console.log('DEBUG Outline: evaluating seed readiness. titleSafe =', titleSafe, 'premiseSafe =', premiseSafe);
        setLoading(true); setError(null); isSeedingRef.current = true;
        try { if (typeof window !== 'undefined') { window.sessionStorage.setItem(SEED_LOCK_KEY, currentSignature); } } catch {}
        if (!((titleSafe && titleSafe.trim()) || (premiseSafe && premiseSafe.trim())))
        {
          console.log('DEBUG Outline: Missing title/premise after sanitize, setting error');
          setError("Missing seed info. Return and provide an idea or description.");
          setLoading(false);
          return;
        }
        const payload = {
          title: titleSafe || "Untitled Codex",
          premise: premiseSafe || titleSafe,
          prompt: (premiseSafe || titleSafe || "Untitled Codex"),
          ageRange: normalizeAgeRange(ageRange),
          genre,
          chapters: chaptersTarget,
          keypoints: keypoints || undefined,
          style,
          // Policy hint: request strictly fictionalized content and avoidance of real political figures
          policyHint: "Fictionalize any sensitive or political content; avoid real names; keep it age-appropriate and non-political."
        };
        console.log('DEBUG Outline: Sending payload to seedStory @', ENDPOINTS?.seed || 'n/a', 'payload =', payload);
        const { toc: tocRaw } = await seedStory(payload);
        console.log('DEBUG: Received TOC:', tocRaw);
        const normalized = (tocRaw || "")
          .replace(/```[\s\S]*?```/g, "")
          .replace(/\*\*(.*?)\*\*/g, "$1")
          .replace(/^[^\n]*Table of Contents[^\n]*\n?/i, "")
          .replace(/^Based on[\s\S]*?:\n+/i, "");
        setToc(normalized);
        const parsedRaw = parseTOC(normalized);
        const parsed = enforceChapterCount(parsedRaw, chaptersTarget);
        setChapters(parsed);
        // Persist into session so Storyforge can pick up
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY);
          const data = raw ? JSON.parse(raw) : {};
          const updated = { ...data, toc: normalized, chapters: parsed };
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        } catch {}
      } catch (e: any) {
        setError(e?.message || "Seeding outline failed");
      } finally {
        setLoading(false);
        isSeedingRef.current = false;
        try { if (typeof window !== 'undefined') { window.sessionStorage.removeItem(SEED_LOCK_KEY); } } catch {}
        // Reset the retry trigger if used
        if (reseedTick > 0) { setReseedTick(0); }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, reseedTick, title, premise, ageRange, genre, chaptersTarget, keypoints, style]);

  return (
    <div className="min-h-screen text-amber-950">
      <div className="relative">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <div className="flex items-center gap-3">
            <motion.div initial={{opacity:0, y:-8}} animate={{opacity:1, y:0}} transition={{delay:0.1}} className="rounded-2xl bg-amber-200/70 p-2 shadow">
              <Book className="h-6 w-6" />
            </motion.div>
            <motion.h1 initial={{opacity:0, y:0}} animate={{opacity:1, y:0}} className="text-2xl md:text-3xl font-serif tracking-wide">Outline</motion.h1>
          </div>
          <p className="mt-1 text-amber-900/80">{title || "Untitled Codex"}</p>
        </div>
      </div>

      <main className="relative mx-auto max-w-6xl px-4 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1"><CoverCard coverUrl={coverUrl} title={title || "Untitled Codex"} /></div>
          <div className="lg:col-span-2">
            <div className="relative rounded-2xl border border-amber-300 bg-amber-50/70 p-4 min-h-[240px]">
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-amber-100/60 backdrop-blur-sm">
                  <div className="flex items-center gap-3 text-amber-900">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Engraving your table of contents…</span>
                  </div>
                </div>
              )}
              {error && (
                <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-800">
                  <div>{error}</div>
                  <div className="mt-2">
                    <button onClick={()=>setReseedTick(t=>t+1)} className="rounded-lg bg-red-600 text-white px-3 py-1 text-xs">Retry seeding</button>
                  </div>
                </div>
              )}
              {!loading && !error && chapters.length>0 && (
                <ol className="space-y-2">
                  {chapters.map(ch => {
                    const done = generatedIds.includes(ch.id);
                    return (
                      <li
                        key={ch.id}
                        className={`rounded-xl border p-3 cursor-pointer ${done ? "border-emerald-300 bg-emerald-50/60" : "border-amber-200 bg-white/70"}`}
                        onClick={() => router.push({ pathname: "/Read", query: { chapter: ch.id, title: (title || "Untitled Codex") } })}
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-serif font-semibold">{ch.id}. {ch.heading}</div>
                          <div className="text-xs text-amber-900/70">{done ? "engraved" : "tap to generate"}</div>
                        </div>
                        {ch.synopsis && <div className="text-sm text-amber-900/80">{ch.synopsis}</div>}
                      </li>
                    );
                  })}
                </ol>
              )}
              {!loading && !error && chapters.length===0 && (
                <div className="text-amber-900/80">
                  <div>No chapters detected. The model may have declined or produced non-TOC text.</div>
                  <div className="mt-2">
                    <button onClick={()=>setReseedTick(t=>t+1)} className="rounded-lg bg-amber-600 text-white px-3 py-1 text-xs">Retry seeding</button>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              {chapters.length>0 && generatedIds.length >= chapters.length && (
                <button
                  onClick={() => router.push("/Read?export=1")}
                  className="inline-flex items-center justify-center rounded-xl bg-amber-600 text-white px-5 py-3 shadow hover:bg-amber-700"
                  disabled={loading}
                >
                  Export Full Book
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}


