import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StepForward, Download, CornerDownRight, CheckCircle2, StepBack } from "lucide-react";

export function Reader({ outline, chapters, scenes, influence, setInfluence, onNext, onExport, onPrev, onSceneImageBroken }:{
  outline:any;
  chapters:{ id:number; heading:string; synopsis?:string }[];
  scenes:{ chapterId:number; chapterHeading:string; html:string; imageUrl?:string|null }[];
  influence:string;
  setInfluence:(s:string)=>void;
  onNext:()=>void;
  onExport:()=>void;
  onPrev:()=>void;
  onSceneImageBroken?:(idx:number)=>void;
}){
  const allDone = scenes.length >= chapters.length;
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
                <div className="font-serif text-lg mb-2">Chapter {sc.chapterId}: {sc.chapterHeading}</div>
                {sc.imageUrl && <img src={sc.imageUrl} alt="Scene" className="w-full h-auto rounded-lg border border-amber-200 mb-3" onError={()=> onSceneImageBroken && onSceneImageBroken(idx)} />}
                {/* eslint-disable-next-line react/no-danger */}
                <div className="prose prose-amber max-w-none" dangerouslySetInnerHTML={{ __html: sc.html }} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


