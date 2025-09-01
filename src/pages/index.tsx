import React, { useEffect, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";

export default function Home()
{
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [hasSession, setHasSession] = useState(false);
  const STORAGE_KEY = "storyforge.session.v1";

  function onSubmit(e: React.FormEvent)
  {
    e.preventDefault();
    // If a new idea is provided, proactively clear any existing session so a fresh seed is guaranteed
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      const data = raw ? JSON.parse(raw) : {};
      const updated = { ...data, title: "", premise: idea.trim(), toc: null, chapters: [], scenes: [], seedSignature: undefined };
      if (typeof window !== 'undefined') { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); }
    } catch {}
    const q = new URLSearchParams();
    if (idea.trim()) q.set("idea", idea.trim());
    router.push(`/Storyforge${q.toString() ? `?${q.toString()}` : ""}`);
  }

  useEffect(()=>{
    try{
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (raw){
        const data = JSON.parse(raw);
        setHasSession(!!(data?.toc || (Array.isArray(data?.chapters) && data.chapters.length)));
      }
    } catch { setHasSession(false); }
  }, []);

  return (
    <>
    <Head>
      <title>Storyforge — Enchanted story maker</title>
      <meta name="description" content="Seed a tale and refine chapters as you go." />
      <meta property="og:title" content="Storyforge — Enchanted story maker" />
      <meta property="og:description" content="Seed a tale and refine chapters as you go." />
      <meta property="og:url" content="https://story.codemusic.ca/" />
      <meta property="og:type" content="website" />
      <meta property="og:image" content="https://story.codemusic.ca/Storyforge.png" />
      <meta property="og:image:secure_url" content="https://story.codemusic.ca/Storyforge.png" />
      <meta property="og:image:type" content="image/png" />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content="Storyforge cover" />
      <meta name="twitter:title" content="Storyforge — Enchanted story maker" />
      <meta name="twitter:description" content="Seed a tale and refine chapters as you go." />
      <meta name="twitter:image" content="https://story.codemusic.ca/Storyforge.png" />
      <meta name="twitter:image:alt" content="Storyforge cover" />
    </Head>
    <main className="min-h-screen flex items-center justify-center bg-amber-50 text-amber-950">
      <div className="text-center space-y-4">
        <h1 className="text-3xl md:text-4xl font-serif">Welcome to the Enchanted Storyforge</h1>
        <p className="text-amber-900/80">Enter an idea to seed your tale, then refine chapters as you go.</p>
        <form onSubmit={onSubmit} className="max-w-xl mx-auto space-y-3">
          <input
            className="w-full rounded-xl border border-amber-300 bg-white px-4 py-3 text-base outline-none focus:ring-2 focus:ring-amber-400"
            placeholder="Whisper your story idea…"
            value={idea}
            onChange={e=>setIdea(e.target.value)}
          />
          <button type="submit" className="inline-flex items-center justify-center rounded-xl bg-amber-600 text-white px-5 py-3 shadow hover:bg-amber-700 w-full">
            Forge My Story
          </button>
        </form>
        {hasSession && (
          <div className="max-w-xl mx-auto">
            <button onClick={()=>router.push("/Outline")} className="mt-2 inline-flex items-center justify-center rounded-xl bg-amber-100 text-amber-900 px-5 py-3 border border-amber-300 w-full">
              Continue last story
            </button>
          </div>
        )}
      </div>
    </main>
    </>
  );
}


