import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { motion } from "framer-motion";
import { Wand2 } from "lucide-react";
import { CoverCard } from "../components/CoverCard";
import { SeedForm } from "../components/SeedForm";
import { Reader } from "../components/Reader";
import { parseTOC, buildCoverPromptFromTOC, ChapterItem } from "../lib/parse";
import { seedStory, expandChapter, genImage, exportBook, BASE, primeStory, PrimeInfo, regenerateSessionId } from "../services/n8n";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { normalizeAgeRange, chapterRangeForAgeRange } from "../lib/age";

const AncientBackground: React.FC = () => (
  <div className="pointer-events-none fixed inset-0 -z-10">
    <div className="absolute inset-0 bg-gradient-to-b from-amber-50 via-amber-100 to-amber-50" />
    <svg className="absolute inset-0 w-full h-full opacity-20 mix-blend-multiply">
      <defs>
        <pattern id="runes" width="120" height="120" patternUnits="userSpaceOnUse">
          <text x="8" y="28" className="fill-amber-900/50 text-[22px] font-serif">ᚠᚢᚦᚨᚱ</text>
          <text x="36" y="70" className="fill-amber-900/40 text-[18px] font-serif">ᚷᚹᚺᚾᛁ</text>
          <text x="18" y="108" className="fill-amber-900/30 text-[20px] font-serif">ᛃᛇᛈᛉᛋ</text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#runes)" />
    </svg>
    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-amber-200/40" />
    <div className="absolute inset-0 shadow-[inset_0_0_180px_rgba(0,0,0,0.25)]" />
  </div>
);

export default function StoryforgePage(){
  const router = useRouter();
  const idea = typeof router.query?.idea === 'string' ? router.query.idea : "";
  const STORAGE_KEY = "storyforge.session.v1";
  const PRIME_LOCK_KEY = "storyforge.prime.lock.v1";
  const [title, setTitle] = useState("");
  const [premise, setPremise] = useState(idea || "");
  const [ageRange, setAgeRange] = useState(normalizeAgeRange("6-8"));
  const [genre, setGenre] = useState("fantasy");
  const [chaptersTarget, setChaptersTarget] = useState(8);
  const [keypoints, setKeypoints] = useState("");
  const [style, setStyle] = useState("warm, whimsical, gentle-humor");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [status, setStatus] = useState<string|undefined>(undefined);
  const [toc, setToc] = useState<string| null>(null);
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [scenes, setScenes] = useState<{ chapterId:number; chapterHeading:string; html:string; imageUrl?:string|null }[]>([]);
  const [influence, setInfluence] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const primeLockRef = useRef(false);

  function clearOutlineState()
  {
    setToc(null);
    setChapters([]);
    setScenes([]);
  }

  function onChangeTitle(next: string)
  {
    setTitle(next);
    clearOutlineState();
  }

  function onChangePremise(next: string)
  {
    setPremise(next);
    clearOutlineState();
  }

  async function onSeed(){
    // Persist latest seed details and route to Outline page (where seeding happens)
    try{
      // Fresh cognitive seed: renew session so downstream outline/chapters bind to this arc
      regenerateSessionId();
      const payload = { title, premise, ageRange: normalizeAgeRange(ageRange), genre, chaptersTarget, keypoints, style, coverUrl };
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : {};
        // Clear prior outline state so Outline will refetch for a new idea
        const updated = { ...data, ...payload, toc: null, chapters: [], scenes: [], seedSignature: undefined };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      router.push("/Outline?reseed=1");
    } finally {}
  }

  async function onNext(){
    try{
      if (!chapters.length) return;
      const idx = scenes.length;
      const chapterMeta = chapters[idx];
      setLoading(true); setError(null);
      const normAge = normalizeAgeRange(ageRange);
      const lengthHint = chapterRangeForAgeRange(normAge);
      const context = { title: title || "Untitled Codex", toc, priorHtml: scenes.map(s=>s.html), keypoints, genre, ageRange: normAge, lengthHint, style };
      const influenceBracket = `[context: genre=${genre}; age=${normAge}; style=${style}; notes=${(keypoints||"").slice(0,120)}]`;
      const combinedInfluence = (influence && influence.trim()) ? `${influenceBracket} ${influence.trim()}` : influenceBracket;
      const { html } = await expandChapter({ context, chapterIndex: idx, influence: combinedInfluence });
      let imageUrl: string | null = null;
      try { const img = await genImage(`${title} (ages ${normalizeAgeRange(ageRange)}): ${chapterMeta.heading}. ${html.slice(0,180)}...`); imageUrl = img.url; } catch {}
      setScenes(prev => [...prev, { chapterId: chapterMeta.id, chapterHeading: chapterMeta.heading, html, imageUrl }]);
      setInfluence("");
    } catch(e:any){ setError(e.message || "Chapter failed"); }
    finally { setLoading(false); }
  }

  async function onExport(){
    try{
      setLoading(true); setError(null);
      const htmlPagesWithImages = scenes.map(s => {
        const img = s.imageUrl ? `<img src="${s.imageUrl}" alt="Scene for Chapter ${s.chapterId}: ${s.chapterHeading}" style="max-width:100%;height:auto;border:1px solid #e2c084;border-radius:12px;margin:12px 0;"/>` : "";
        return `${img}\n${s.html}`;
      });
      const { downloadUrl, filename } = await exportBook({ htmlPages: htmlPagesWithImages, coverUrl, meta: { title, toc, chapters } });
      if (downloadUrl)
      {
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = filename || `${title||"storybook"}.html`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        if (downloadUrl.startsWith("blob:")) { URL.revokeObjectURL(downloadUrl); }
        return;
      }
      const blob = new Blob([JSON.stringify({ title, toc, chapters, scenes, coverUrl }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `${title||"storybook"}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } finally { setLoading(false); }
  }

  function onPrev(){
    if (scenes.length === 0) return;
    setScenes(prev => prev.slice(0, prev.length - 1));
  }

  // Load cached session; prefer ?idea=... and clear stale outline if it differs
  useEffect(()=>{
    try{
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      const data = raw ? JSON.parse(raw) : {};
      const cachedPremise = data?.premise || "";

      // Prefer router idea over cached premise and clear outline if it differs
      if (idea && idea !== cachedPremise)
      {
        setTitle("");
        setPremise(idea);
        setAgeRange(normalizeAgeRange(data.ageRange || "6-8"));
        setGenre(data.genre || "fantasy");
        setChaptersTarget(typeof data.chaptersTarget === 'number' ? data.chaptersTarget : 8);
        // New cognitive seed: purge prior salience notes to avoid leakage into a new narrative
        setKeypoints("");
        setStyle(data.style || "warm, whimsical, gentle-humor");
        setToc(null);
        setChapters([]);
        setCoverUrl(data.coverUrl || null);
        setScenes([]);
        setInfluence("");
        // Persist the cleared state so subsequent pages don't reuse old outline
        try {
          const updated = { ...data, title: "", premise: idea, toc: null, chapters: [], scenes: [], seedSignature: undefined, keypoints: "" };
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        } catch {}
        // Stay on Storyforge so user can review/edit before building outline
        return;
      }

      // Fallback: hydrate from cache; but if URL has ?idea=, clear cached outline to avoid inheritance
      if (data){
        setTitle(data.title || "");
        setPremise(idea || cachedPremise || "");
        setAgeRange(normalizeAgeRange(data.ageRange || "6-8"));
        setGenre(data.genre || "fantasy");
        setChaptersTarget(typeof data.chaptersTarget === 'number' ? data.chaptersTarget : 8);
        // If a fresh idea is present, start with empty keypoints to prevent priming carry-over
        setKeypoints(idea ? "" : (data.keypoints || ""));
        setStyle(data.style || "warm, whimsical, gentle-humor");
        if (idea){
          setToc(null);
          setChapters([]);
          setScenes([]);
          // Persist cleared keypoints alongside outline reset for a fresh narrative context
          try {
            const updated = { ...data, keypoints: "", toc: null, chapters: [], scenes: [], seedSignature: undefined };
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
          } catch {}
        } else {
          setToc(data.toc || null);
          setChapters(Array.isArray(data.chapters) ? data.chapters : []);
          setScenes(Array.isArray(data.scenes) ? data.scenes : []);
        }
        setCoverUrl(data.coverUrl || null);
        setInfluence("");
      }
    } catch {}
    finally { setHydrated(true); }
  }, [idea]);

  // Salience: when the desired chapter count changes, invalidate any cached outline
  useEffect(() =>
  {
    if (!hydrated) { return; }
    clearOutlineState();
    try
    {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      const data = raw ? JSON.parse(raw) : {};
      const updated = { ...data, toc: null, chapters: [], scenes: [], seedSignature: undefined };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {}
  }, [chaptersTarget, hydrated]);

  // Auto-trigger seeding when the current seed signature differs from the cached one
  const autoSeededRef = useRef(false);
  useEffect(()=>{
    if (!hydrated || autoSeededRef.current) { return; }
    try{
      const currentSignature = JSON.stringify({ title, premise, ageRange: normalizeAgeRange(ageRange), genre, chaptersTarget, keypoints, style });
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      const data = raw ? JSON.parse(raw) : {};
      const storedSignature = data?.seedSignature;
      if (storedSignature !== currentSignature)
      {
        autoSeededRef.current = true;
        // Persist cleared outline to ensure fresh seed and navigate
        try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, toc: null, chapters: [], scenes: [], seedSignature: undefined, title, premise, ageRange: normalizeAgeRange(ageRange), genre, chaptersTarget, keypoints, style })); } catch {}
        // Do not auto-navigate; let the user click Build Outline
      }
    } catch {}
  }, [hydrated, title, premise, ageRange, genre, chaptersTarget, keypoints, style, router]);

  // Persist session
  useEffect(()=>{
    if (typeof window === 'undefined') return;
    const payload = {
      title, premise, ageRange: normalizeAgeRange(ageRange), genre, chaptersTarget, keypoints, style,
      toc, chapters, coverUrl, scenes
    };
    try{ window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch {}
  }, [title, premise, ageRange, genre, chaptersTarget, keypoints, style, toc, chapters, coverUrl, scenes]);

  // Prefill from prime endpoint, then auto-seed if desired
  useEffect(()=>{
    if (!hydrated) return;
    (async () => {
      if (idea && !chapters.length && !toc){
        // Idempotency guard: avoid duplicate prime/genImage under React Strict Mode
        try {
          const sig = JSON.stringify({ idea });
          const lockedSig = typeof window !== 'undefined' ? window.sessionStorage.getItem(PRIME_LOCK_KEY) : null;
          if (primeLockRef.current || lockedSig === sig) { return; }
          primeLockRef.current = true;
          if (typeof window !== 'undefined') { window.sessionStorage.setItem(PRIME_LOCK_KEY, sig); }
        } catch {}
        try{
          setLoading(true); setStatus("Fetching seed info…");
          const { info } = await primeStory({ prompt: idea });
          if (info){
            if (typeof (info as any) === 'string'){
              // If agent returned plain text by mistake, use as description
              setPremise((info as any) || "");
            } else {
              if (info.title) setTitle(info.title);
              if (info.description) setPremise(info.description);
              if (info.ageRange) setAgeRange(normalizeAgeRange(info.ageRange));
              if (info.genre) setGenre(info.genre);
              if (typeof info.chapters === 'number') setChaptersTarget(info.chapters);
              if (info.keypoints) setKeypoints(info.keypoints);
              if (info.style) setStyle(info.style);
            }
            // Kick off cover image pre-gen based on description/title
            const coverPrompt = buildCoverPromptFromTOC(info.title || title || "Untitled Codex", (info.description || premise || "").split("\n").slice(0,2).join("\n"));
            try { setStatus("Generating cover image…"); const img = await genImage(coverPrompt); setCoverUrl(img.url); } catch {}
          }
        } catch(e:any){ setError(e.message || "Prime failed"); }
        finally { setLoading(false); setStatus(undefined); }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea, hydrated]);

  // Regenerate cover if image fails to load
  const handleCoverBroken = async () => {
    try {
      const coverPrompt = buildCoverPromptFromTOC(title || "Untitled Codex", (premise || "").split("\n").slice(0,2).join("\n"));
      setStatus("Regenerating cover image…");
      const img = await genImage(coverPrompt);
      setCoverUrl(img.url);
    } catch {}
    finally { setStatus(undefined); }
  };

  // Regenerate scene image if broken
  const handleSceneImageBroken = async (sceneIndex: number) => {
    try {
      const sc = scenes[sceneIndex];
      if (!sc) return;
      const prompt = `${title} (ages ${normalizeAgeRange(ageRange)}): Chapter ${sc.chapterId} - ${sc.chapterHeading}. ${sc.html.replace(/<[^>]+>/g, " ").slice(0,180)}...`;
      const img = await genImage(prompt);
      setScenes(prev => prev.map((s, i) => i === sceneIndex ? { ...s, imageUrl: img.url } : s));
    } catch {
      // Clear broken image to avoid endless error loops
      setScenes(prev => prev.map((s, i) => i === sceneIndex ? { ...s, imageUrl: null } : s));
    }
  };

  return (
    <div className="min-h-screen text-amber-950">
      <AncientBackground />
      <header className="relative">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <div className="flex items-center gap-3">
            <motion.div initial={{opacity:0, y:-8}} animate={{opacity:1, y:0}} transition={{delay:0.1}} className="rounded-2xl bg-amber-200/70 p-2 shadow">
              <Wand2 className="h-6 w-6" />
            </motion.div>
            <motion.h1 initial={{opacity:0, y:0}} animate={{opacity:1, y:0}} className="text-3xl md:text-4xl font-serif tracking-wide">The Storyforge Terminal</motion.h1>
          </div>
          <p className="mt-2 max-w-2xl text-amber-900/80">This site <em>is</em> the relic. Seed a tale, step through each engraved chapter, and watch the images appear.</p>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-4 pb-28">
        <div className="mt-0 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <SeedForm
              state={{ title, premise, ageRange, genre, chapters: chaptersTarget, keypoints, style, loading, status, error, baseLabel: (BASE.replace("https://","")) }}
              actions={{ setTitle: onChangeTitle, setPremise: onChangePremise, setAgeRange, setGenre, setChapters: setChaptersTarget, setKeypoints, setStyle, onSeed, onPrime: async ()=>{
                try{
                  setLoading(true); setStatus("Fetching seed info…"); setError(null);
                  const { info } = await primeStory({ prompt: idea || premise });
                  if (info){
                    // Clear outline if prime changes the seed
                    if ((info.title && info.title !== title) || (info.description && info.description !== premise))
                    {
                      clearOutlineState();
                    }
                    if (info.title) setTitle(info.title);
                    if (info.description) setPremise(info.description);
                    if (info.ageRange) setAgeRange(normalizeAgeRange(info.ageRange));
                    if (info.genre) setGenre(info.genre);
                    if (typeof info.chapters === 'number') setChaptersTarget(info.chapters);
                    if (info.keypoints) setKeypoints(info.keypoints);
                    if (info.style) setStyle(info.style);
                    const coverPrompt = buildCoverPromptFromTOC(info.title || title || "Untitled Codex", (info.description || premise || "").split("\n").slice(0,2).join("\n"));
                    try { setStatus("Generating cover image…"); const img = await genImage(coverPrompt); setCoverUrl(img.url); } catch {}
                  }
                } catch(e:any){ setError(e.message || "Prime failed"); }
                finally { setLoading(false); setStatus(undefined); }
              } }}
            />
          </div>
          <div>
            <CoverCard coverUrl={coverUrl} title={title||"Untitled Codex"} onBroken={handleCoverBroken} />
          </div>
        </div>
        {chapters.length>0 && (
          <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-3">
              <Reader
                outline={{ title, toc }}
                chapters={chapters}
                scenes={scenes}
                influence={influence}
                setInfluence={setInfluence}
                onNext={onNext}
                onExport={onExport}
                onPrev={onPrev}
                onSceneImageBroken={handleSceneImageBroken}
                ageRange={ageRange}
              />
            </div>
          </div>
        )}
        {chapters.length>0 && scenes.length < chapters.length && (
          <div className="fixed bottom-0 left-0 right-0 z-20">
            <div className="mx-auto max-w-6xl px-4 pb-4">
              <div className="rounded-2xl border border-amber-300 bg-amber-50/80 backdrop-blur px-3 py-3 shadow-lg">
                <div className="text-xs uppercase text-amber-900/60 mb-2">Influence the next step</div>
                <div className="flex gap-2">
                  <Input value={influence} onChange={e=>setInfluence(e.target.value)} placeholder="A subtle hint (e.g., ‘lanterns sway in a 7/8 rhythm’)" />
                  <Button onClick={onNext} disabled={loading}>Apply & Continue</Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}


