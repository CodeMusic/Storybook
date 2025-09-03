import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StepForward, Download, CornerDownRight, CheckCircle2, StepBack } from "lucide-react";
import { proseScaleClassForAgeRange, headingSizeClassForAgeRange } from "../lib/age";

export function Reader({ outline, chapters, scenes, influence, setInfluence, onNext, onExport, onPrev, onSceneImageBroken, ageRange }:{
  outline:any;
  chapters:{ id:number; heading:string; synopsis?:string }[];
  scenes:{ chapterId:number; chapterHeading:string; html:string; imageUrl?:string|null }[];
  influence:string;
  setInfluence:(s:string)=>void;
  onNext:()=>void;
  onExport:()=>void;
  onPrev:()=>void;
  onSceneImageBroken?:(idx:number)=>void;
  ageRange?: string;
}){
  const allDone = scenes.length >= chapters.length;
  const proseScale = proseScaleClassForAgeRange(ageRange || "6-8");
  const headingScale = headingSizeClassForAgeRange(ageRange || "6-8");
  function stripFirstHeadingTag(html: string): string
  {
    if (!html || !html.trim()) { return html; }
    const re = /^\s*((?:<div[^>]*class=\"[^\"]*words-flash[^\"]*\"[^>]*>\s*)?)(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>\s*)/i;
    return html.replace(re, (_m, prefix) => `${prefix}`);
  }
  function stripLeadingChapterLabel(html: string): string
  {
    if (!html || !html.trim()) { return html; }
    const rePara = /^\s*((?:<div[^>]*class=\"[^\"]*words-flash[^\"]*\"[^>]*>\s*)?(?:<p[^>]*>\s*)?)\s*Chapter\s+[^:]{1,80}:\s*/i;
    const withoutParaPrefix = html.replace(rePara, (_m, prefix) => `${prefix}`);
    if (withoutParaPrefix !== html) { return withoutParaPrefix; }
    const reRaw = /^\s*Chapter\s+[^:]{1,80}:\s*/i;
    return html.replace(reRaw, "");
  }
  function extractChapterTitleFromHtml(html: string): string | null
  {
    if (!html || !html.trim()) { return null; }
    const s = html.toString();
    const reTag = /^\s*(?:<div[^>]*class=\"[^\"]*words-flash[^\"]*\"[^>]*>\s*)?(?:<h[1-6][^>]*>|<p[^>]*>)\s*Chapter\s+[^:]{1,80}:\s*([^<\n]{1,160})/i;
    const m1 = s.match(reTag);
    if (m1 && m1[1]) { return m1[1].trim(); }
    const reRaw = /^\s*Chapter\s+[^:]{1,80}:\s*([^\n<]{1,160})/i;
    const m2 = s.match(reRaw);
    if (m2 && m2[1]) { return m2[1].trim(); }
    return null;
  }
  return (
    <Card className="bg-amber-50/80 border-amber-300">
      <CardHeader className="flex justify-between">
        <CardTitle className="text-amber-950">Engraving the Chapters</CardTitle>
        <div className="flex items-center gap-2">
          {!allDone && scenes.length>0 && (
            <Button variant="secondary" onClick={onPrev}><StepBack className="mr-2 h-4 w-4" /> Back</Button>
          )}
          {allDone ? <Button onClick={onExport}><Download className="mr-2 h-4 w-4" /> Export Book</Button>
                   : <Button onClick={onNext}><StepForward className="mr-2 h-4 w-4" /> Read Next Chapter</Button>}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <ol className="space-y-2">
          {chapters.map((ch,i)=>{
            const done = i < scenes.length;
            const active = i === scenes.length && !allDone;
            return (
              <li key={ch.id} className={`rounded-xl border p-3 ${done?"border-emerald-300 bg-emerald-50/60":"border-amber-200 bg-white/60"}`}>
                <div className="flex items-center justify-between">
                  <div className="font-serif font-semibold">{ch.id}. {ch.heading}</div>
                  <div className="text-xs flex items-center gap-1">
                    {done ? (<><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Engraved</>)
                          : active ? (<>…etching</>)
                          : (<>pending</>)}
                  </div>
                </div>
                {ch.synopsis && <div className="text-sm text-amber-900/80">{ch.synopsis}</div>}
              </li>
            );
          })}
        </ol>

        {scenes.length>0 && (
          <div className="space-y-4">
            <div className="text-amber-900/70 uppercase text-xs">Story so far</div>
            {scenes.map((sc, idx)=>(
              <div key={idx} className="rounded-2xl border border-amber-200 bg-white/70 p-4">
                <div className={`font-serif ${headingScale} mb-2 whitespace-normal break-words`}>
                  {(() => {
                    const derived = extractChapterTitleFromHtml(sc.html);
                    const heading = sc.chapterHeading || "";
                    if (derived && derived.trim()) { return <>Chapter {sc.chapterId}: {derived}</>; }
                    if (/^\s*chapter\s+/i.test(heading)) { return <>{heading}</>; }
                    return <>Chapter {sc.chapterId}: {heading}</>;
                  })()}
                </div>
                {sc.imageUrl && <img src={sc.imageUrl} alt="Scene" className="w-full h-auto rounded-lg border border-amber-200 mb-3" onError={()=> onSceneImageBroken && onSceneImageBroken(idx)} />}
                {/* eslint-disable-next-line react/no-danger */}
                <div className={`${proseScale} prose-amber max-w-none`} dangerouslySetInnerHTML={{ __html: stripLeadingChapterLabel(stripFirstHeadingTag(sc.html)) }} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


