import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ShieldCheck, Sparkles, RefreshCw, Play } from "lucide-react";

export function SeedForm({ state, actions }:{
  state:{ title:string; premise:string; ageRange:string; genre:string; chapters:number; keypoints:string; style:string; loading:boolean; status?:string; error:string|null; baseLabel:string };
  actions:{ setTitle:(s:string)=>void; setPremise:(s:string)=>void; setAgeRange:(s:string)=>void; setGenre:(s:string)=>void; setChapters:(n:number)=>void; setKeypoints:(s:string)=>void; setStyle:(s:string)=>void; onSeed:()=>void; onPrime?:()=>void };
}){
  const { title, premise, ageRange, genre, chapters, keypoints, style, loading, status, error, baseLabel } = state;
  const { setTitle, setPremise, setAgeRange, setGenre, setChapters, setKeypoints, setStyle, onSeed, onPrime } = actions;
  // Ensure UI can represent any returned age range (e.g., "6-8")
  const canonicalAgeRanges = ["1-3", "4-8", "6-8", "9-15", "16-20", "21-25", "25+"];
  const ageRangeOptions = canonicalAgeRanges.includes(ageRange) ? canonicalAgeRanges : [ageRange, ...canonicalAgeRanges];
  const labelForRange = (r: string) => r.replace("-", "–");
  // Expanded genre taxonomy for richer creative prompts
  const genreArchetypes: { value: string; label: string }[] = [
    { value: "fantasy", label: "Fantasy" },
    { value: "adventure", label: "Adventure" },
    { value: "mystery", label: "Mystery" },
    { value: "sci-fi", label: "Sci‑Fi" },
    { value: "fairy-tale", label: "Fairy Tale" },
    { value: "historical", label: "Historical" },
    { value: "horror", label: "Horror" },
    { value: "humor", label: "Humor" },
    { value: "magical-realism", label: "Magical Realism" },
    { value: "mythology", label: "Mythology" },
    { value: "fable", label: "Fable" },
    { value: "superhero", label: "Superhero" },
    { value: "space-opera", label: "Space Opera" },
    { value: "cyberpunk", label: "Cyberpunk" },
    { value: "romance", label: "Romance" },
    { value: "thriller", label: "Thriller" },
    { value: "psychological-thriller", label: "Psychological Thriller" },
    { value: "suspense", label: "Suspense" },
    { value: "cozy-mystery", label: "Cozy Mystery" },
    { value: "survival", label: "Survival" },
    { value: "western", label: "Western" },
    { value: "family", label: "Family" },
    { value: "school-life", label: "School Life" },
    { value: "inspirational", label: "Inspirational" },
    { value: "moral-allegory", label: "Moral Allegory" },
    { value: "educational", label: "Educational" },
    { value: "time-travel", label: "Time Travel" },
    { value: "science", label: "Science" },
    { value: "nature", label: "Nature" },
    { value: "workplace", label: "Workplace" },
    { value: "war", label: "War" },
    { value: "crime", label: "Crime" },
    { value: "culinary", label: "Culinary" },
    { value: "noir", label: "Noir" },
    { value: "comedy", label: "Comedy" },
    { value: "parody", label: "Parody" },
    { value: "satire", label: "Satire" }
  ];
  // Ensure the current selection is always visible even if not in the default taxonomy
  const genreOptions = genreArchetypes.some(g => g.value === genre)
    ? genreArchetypes
    : [{ value: genre, label: genre.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) }, ...genreArchetypes];
  return (
    <Card className="relative backdrop-blur bg-amber-100/70 border-amber-300 shadow-xl rounded-2xl">
      <CardHeader className="flex justify-between">
        <CardTitle className="flex items-center gap-2 text-amber-950">
          <Sparkles className="h-5 w-5" /> Seed the Story Codex
        </CardTitle>
        <div className="flex items-center gap-2 text-xs text-amber-800/70">
          <ShieldCheck className="h-4 w-4" /> Endpoint base: <span className="font-mono">{baseLabel}</span>
          {onPrime && (
            <Button variant="secondary" onClick={onPrime} disabled={loading} className="ml-2 h-6 px-2 py-1 text-xs">Retry seed info</Button>
          )}
        </div>
      </CardHeader>
      <CardContent className={`grid grid-cols-1 md:grid-cols-5 gap-4 ${loading ? "opacity-60" : ""}`}>
        <div className="md:col-span-3 space-y-3">
          <Input placeholder="Title (optional)" value={title} onChange={e=>setTitle(e.target.value)} />
          <Textarea placeholder="Whisper your premise…" value={premise} onChange={e=>setPremise(e.target.value)} rows={5} />
        </div>
        <div className="md:col-span-2 grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs uppercase tracking-wide text-amber-900/70">Age Range</label>
            <select
              className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
              value={ageRange}
              onChange={e=>setAgeRange(e.target.value)}
            >
              {ageRangeOptions.map(r => (
                <option key={r} value={r}>{labelForRange(r)}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-xs uppercase tracking-wide text-amber-900/70">Genre</label>
            <select
              className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
              value={genre}
              onChange={e=>setGenre(e.target.value)}
            >
              {genreOptions.map(g => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-amber-900/70">How many chapters?</label>
            <Input type="number" min={3} max={20} value={chapters} onChange={e=>setChapters(parseInt(e.target.value||"8"))} />
          </div>
          <div className="col-span-2">
            <label className="text-xs uppercase tracking-wide text-amber-900/70">Key points (optional)</label>
            <Textarea placeholder="e.g., Chapter 2: the lantern goes out; Chapter 5: the map is mirrored" value={keypoints} onChange={e=>setKeypoints(e.target.value)} rows={3} />
          </div>
          <div className="col-span-2">
            <label className="text-xs uppercase tracking-wide text-amber-900/70">Style Tags</label>
            <Input value={style} onChange={e=>setStyle(e.target.value)} />
          </div>
          <div className="flex items-end gap-2 col-span-2">
            <Button onClick={onSeed} disabled={loading} className="flex-1">
              {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin"/> : <Play className="mr-2 h-4 w-4" />}
              Build Outline
            </Button>
          </div>
          {error && <div className="col-span-2 rounded-xl border border-red-300 bg-red-50 p-3 text-red-800">{error}</div>}
        </div>
      </CardContent>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-amber-100/60 backdrop-blur-sm">
          <div className="flex items-center gap-3 text-amber-900">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span>{status || "Working… please wait"}</span>
          </div>
        </div>
      )}
    </Card>
  );
}


