import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function CoverCard({ coverUrl, title }:{ coverUrl?:string|null; title:string }){
  return (
    <Card className="bg-amber-50/80 border-amber-300 overflow-hidden">
      {coverUrl && <img src={coverUrl} alt="Cover" className="w-full aspect-[4/3] object-cover" />}
      <CardHeader><CardTitle className="text-amber-950">Codex Core</CardTitle></CardHeader>
      <CardContent className="text-sm">
        <div className="text-amber-900/70 uppercase text-xs">Title</div>
        <div className="font-serif text-lg">{title}</div>
      </CardContent>
    </Card>
  );
}


