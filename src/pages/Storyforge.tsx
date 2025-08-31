import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { motion } from "framer-motion";
import { Wand2 } from "lucide-react";
import { CoverCard } from "../components/CoverCard";
import { SeedForm } from "../components/SeedForm";
import { Reader } from "../components/Reader";
import { parseTOC, buildCoverPromptFromTOC, ChapterItem } from "../lib/parse";
import { seedStory, expandChapter, genImage, exportBook, BASE, primeStory, PrimeInfo } from "../services/n8n";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
  const [title, setTitle] = useState("");
  const [premise, setPremise] = useState(idea || "");
  const [ageRange, setAgeRange] = useState("6-8");
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
      const payload = { title, premise, ageRange, genre, chaptersTarget, keypoints, style, coverUrl };
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : {};
        // Clear prior outline state so Outline will refetch for a new idea
        const updated = { ...data, ...payload, toc: null, chapters: [], scenes: [], seedSignature: undefined };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      router.push("/Outline");
    } finally {}
  }

  async function onNext(){
    try{
      if (!chapters.length) return;
      const idx = scenes.length;
      const chapterMeta = chapters[idx];
      setLoading(true); setError(null);
      const context = { title: title || "Untitled Codex", toc, priorHtml: scenes.map(s=>s.html), keypoints, genre, ageRange };
      const { html } = await expandChapter({ context, chapterIndex: idx, influence: influence.trim() || undefined });
      let imageUrl: string | null = null;
      try { const img = await genImage(`${title}: ${chapterMeta.heading}. ${html.slice(0,180)}...`); imageUrl = img.url; } catch {}
      setScenes(prev => [...prev, { chapterId: chapterMeta.id, chapterHeading: chapterMeta.heading, html, imageUrl }]);
      setInfluence("");
    } catch(e:any){ setError(e.message || "Chapter failed"); }
    finally { setLoading(false); }
  }

  async function onExport(){
    try{
      setLoading(true); setError(null);
      const { downloadUrl, filename } = await exportBook({ htmlPages: scenes.map(s=>s.html), coverUrl, meta: { title, toc, chapters } });
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

  // Load cached session
  useEffect(()=>{
    try{
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (!raw) { setHydrated(true); return; }
      const data = JSON.parse(raw);
      if (data){
        setTitle(data.title || "");
        setPremise(data.premise || idea || "");
        setAgeRange(data.ageRange || "6-8");
        setGenre(data.genre || "fantasy");
        setChaptersTarget(typeof data.chaptersTarget === 'number' ? data.chaptersTarget : 8);
        setKeypoints(data.keypoints || "");
        setStyle(data.style || "warm, whimsical, gentle-humor");
        setToc(data.toc || null);
        setChapters(Array.isArray(data.chapters) ? data.chapters : []);
        setCoverUrl(data.coverUrl || null);
        setScenes(Array.isArray(data.scenes) ? data.scenes : []);
        setInfluence("");
      }
    } catch {}
    finally { setHydrated(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist session
  useEffect(()=>{
    if (typeof window === 'undefined') return;
    const payload = {
      title, premise, ageRange, genre, chaptersTarget, keypoints, style,
      toc, chapters, coverUrl, scenes
    };
    try{ window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch {}
  }, [title, premise, ageRange, genre, chaptersTarget, keypoints, style, toc, chapters, coverUrl, scenes]);

  // Prefill from prime endpoint, then auto-seed if desired
  useEffect(()=>{
    if (!hydrated) return;
    (async () => {
      if (idea && !chapters.length && !toc){
        try{
          setLoading(true); setStatus("Fetching seed info…");
          const { info } = await primeStory({ prompt: idea });
          if (info){
            if (typeof (info as any) === 'string'){
              // If agent returned plain text by mistake, use as description
              setPremise(prev => prev || (info as any) || "");
            } else {
              if (info.title) setTitle(info.title);
              if (info.description) setPremise(prev => prev || info.description || "");
              if (info.ageRange) setAgeRange(info.ageRange);
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
                    if (info.description) setPremise(prev => prev || info.description || "");
                    if (info.ageRange) setAgeRange(info.ageRange);
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
            <CoverCard coverUrl={coverUrl} title={title||"Untitled Codex"} />
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


