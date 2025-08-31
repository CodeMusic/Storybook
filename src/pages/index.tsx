import React, { useState } from "react";
import { useRouter } from "next/router";

export default function Home()
{
  const router = useRouter();
  const [idea, setIdea] = useState("");

  function onSubmit(e: React.FormEvent)
  {
    e.preventDefault();
    const q = new URLSearchParams();
    if (idea.trim()) q.set("idea", idea.trim());
    router.push(`/Storyforge${q.toString() ? `?${q.toString()}` : ""}`);
  }

  return (
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
      </div>
    </main>
  );
}


