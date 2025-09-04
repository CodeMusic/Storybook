export const BASE = process.env.NEXT_PUBLIC_N8N_BASE || "https://n8n.codemusic.ca/webhook";
const N8N_USER = process.env.NEXT_PUBLIC_N8N_USER || "siteuser";
const N8N_PASS = process.env.NEXT_PUBLIC_N8N_PASS || "codemusai";
const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes for local models
const SESSION_KEY = "storyforge.sessionId.v1";
export const ENDPOINTS = {
  prime: `${BASE}/seedInfo`,        // → JSON basic info from prompt
  seed: `${BASE}/seedStory`,        // → string TOC
  chapter: `${BASE}/expandChapter`, // → string HTML
  image: `${BASE}/genImage`,        // → string image URL
  export: `${BASE}/exportBook`,     // → string download URL
  voice: `${BASE}/voiceforge`,      // → audio bytes or URL
  exportStory: `${BASE}/exportStory`, // → accept full package JSON
};

// Feature flag: attempt one-time regeneration of broken scene images when encountered
export const REGENERATE_BROKEN_IMAGES: boolean = (process.env.NEXT_PUBLIC_REGEN_BROKEN_IMAGES || 'true').toLowerCase() === 'true' || (process.env.NEXT_PUBLIC_REGEN_BROKEN_IMAGES === '1');

function basicAuthHeader(): string {
  const raw = `${N8N_USER}:${N8N_PASS}`;
  try {
    // btoa in browsers; Buffer on Node if ever needed
    // @ts-ignore
    const encoded = typeof btoa === "function" ? btoa(raw) : Buffer.from(raw).toString("base64");
    return `Basic ${encoded}`;
  } catch {
    return "";
  }
}

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response>
{
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(()=> clearTimeout(id));
}

// Session identity: used to correlate requests in n8n for a single story thread
export function getSessionId(): string
{
  try
  {
    if (typeof window !== 'undefined')
    {
      const existing = window.localStorage.getItem(SESSION_KEY);
      if (existing && existing.trim())
      {
        return existing;
      }
      const fresh = generateGuid();
      window.localStorage.setItem(SESSION_KEY, fresh);
      return fresh;
    }
  }
  catch {}
  // SSR or storage unavailable: fall back to ephemeral id per process
  // Note: This won't persist across navigations, but preserves API shape
  return generateGuid();
}

export function regenerateSessionId(): string
{
  const fresh = generateGuid();
  try { if (typeof window !== 'undefined') { window.localStorage.setItem(SESSION_KEY, fresh); } } catch {}
  return fresh;
}

function generateGuid(): string
{
  try
  {
    // Prefer Web Crypto if available
    // @ts-ignore
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    {
      // @ts-ignore
      return crypto.randomUUID();
    }
    // @ts-ignore
    if (typeof crypto !== 'undefined' && crypto.getRandomValues)
    {
      // RFC4122 v4-ish fallback
      const buf = new Uint8Array(16);
      // @ts-ignore
      crypto.getRandomValues(buf);
      buf[6] = (buf[6] & 0x0f) | 0x40;
      buf[8] = (buf[8] & 0x3f) | 0x80;
      const toHex = (n: number) => n.toString(16).padStart(2, '0');
      const hex = Array.from(buf, toHex).join('');
      return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    }
  }
  catch {}
  // Extremely low-tech fallback
  return `sid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function withSession<T extends Record<string, any>>(payload: T): T & { sessionId: string }
{
  const base: any = (payload && typeof payload === 'object') ? payload : ({} as any);
  return { ...base, sessionId: getSessionId() } as T & { sessionId: string };
}

async function postForText(url: string, payload: any): Promise<string> {
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": basicAuthHeader(),
    },
    body: JSON.stringify(withSession(payload))
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Endpoint error ${res.status}`);
  if (!text) throw new Error("Empty response");
  return text;
}

async function postForJson<T>(url: string, payload: any): Promise<T> {
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": basicAuthHeader(),
    },
    body: JSON.stringify(withSession(payload))
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Endpoint error ${res.status}`);
  try { return JSON.parse(text) as T; } catch { throw new Error("Invalid JSON response"); }
}

async function postForRaw(url: string, payload: any): Promise<string>
{
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": basicAuthHeader(),
    },
    body: JSON.stringify(withSession(payload))
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Endpoint error ${res.status}`);
  return text;
}

function coerceTOCString(raw: string): string
{
  const text = (raw || "").toString().trim();
  if (!text) return text;
  // Try JSON parsing first
  try {
    const obj = JSON.parse(text);
    // If array like [{ output: "..." }]
    if (Array.isArray(obj) && obj.length > 0)
    {
      const first = obj[0] as any;
      if (typeof first?.toc === 'string') return first.toc;
      if (typeof first?.output === 'string') return first.output;
    }
    // If object with toc or output
    if (typeof obj === 'object' && obj)
    {
      if (typeof (obj as any).toc === 'string') return (obj as any).toc;
      if (typeof (obj as any).output === 'string') return (obj as any).output;
    }
  } catch {}
  // Not JSON; could be plain text with extra prose. Return as-is; caller may normalize.
  return text;
}

// Heuristic: detect refusal-style outputs so the UI can present a clear error instead
function looksLikeRefusal(text: string): boolean
{
  const t = (text || "").toLowerCase();
  if (!t) { return false; }
  const refusalMarkers = [
    "i cannot",
    "i can't",
    "i won’t",
    "i will not",
    "as an ai",
    "goes against my guidelines",
    "i'm unable to",
    "i am unable to",
    "cannot create a story seed",
    "policy",
    "sensitive"
  ];
  const containsMarker = refusalMarkers.some(marker => t.includes(marker));
  const looksLikeTOC = /chapter\s*\d|table of contents|^\s*\d+[\).]/m.test(t);
  return containsMarker && !looksLikeTOC;
}

function escapeHtml(unsafe: string): string
{
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Decode common HTML entities from model/tool outputs
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

function coerceHTMLString(raw: string): string
{
  const text = (raw || "").toString().trim();
  if (!text) return "";
  // Try JSON parsing first and extract common fields (do not decode before JSON parse)
  try {
    const obj = JSON.parse(text);
    if (Array.isArray(obj) && obj.length > 0)
    {
      const first = obj[0] as any;
      if (typeof first?.html === 'string')
      {
        const htmlCandidate = first.html;
        // If it already looks like HTML, return as-is; otherwise treat as plaintext after decoding
        return /[<][a-zA-Z!/?]/.test(htmlCandidate) ? htmlCandidate : (()=>{
          const decoded = decodeEntities(htmlCandidate);
          const blocks = decoded.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
          const html = blocks.map(block => {
            const withBreaks = escapeHtml(block).replace(/\n/g, "<br/>");
            return `<p>${withBreaks}</p>`;
          }).join("\n");
          return html;
        })();
      }
      if (typeof first?.output === 'string')
      {
        return coerceHTMLString(first.output);
      }
    }
    if (typeof obj === 'object' && obj)
    {
      if (typeof (obj as any).html === 'string')
      {
        const htmlCandidate = (obj as any).html;
        return /[<][a-zA-Z!/?]/.test(htmlCandidate) ? htmlCandidate : (()=>{
          const decoded = decodeEntities(htmlCandidate);
          const blocks = decoded.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
          const html = blocks.map(block => {
            const withBreaks = escapeHtml(block).replace(/\n/g, "<br/>");
            return `<p>${withBreaks}</p>`;
          }).join("\n");
          return html;
        })();
      }
      if (typeof (obj as any).output === 'string')
      {
        return coerceHTMLString((obj as any).output);
      }
    }
  } catch {}
  // Treat as plaintext/markdown; decode entities first to avoid double-escaping
  const decoded = decodeEntities(text);
  // If it already looks like HTML, return as-is
  if (/[<][a-zA-Z!/?]/.test(decoded)) return decoded;
  // Basic plaintext/markdown to HTML: paragraphs and line breaks
  const blocks = decoded.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const html = blocks.map(block => {
    const withBreaks = escapeHtml(block).replace(/\n/g, "<br/>");
    return `<p>${withBreaks}</p>`;
  }).join("\n");
  return html;
}

export async function seedStory(payload: any){
  console.log('DEBUG seedStory: endpoint =', ENDPOINTS.seed);
  console.log('DEBUG seedStory: payload =', payload);
  try {
    const raw = await postForText(ENDPOINTS.seed, payload);
    console.log('DEBUG seedStory: raw response =', raw);
    const toc = coerceTOCString(raw);
    if (looksLikeRefusal(toc))
    {
      throw new Error("The model declined to create an outline. We'll fictionalize sensitive content and avoid real names. Please retry.");
    }
    console.log('DEBUG seedStory: parsed toc =', toc);
    return { toc };
  } catch (error) {
    console.error('DEBUG seedStory: error =', error);
    throw error;
  }
}
export async function expandChapter(req: { context:any; chapterIndex:number; influence?:string; lengthHint?: { range: [number, number]; label: string } })
{
  const raw = await postForText(ENDPOINTS.chapter, req);
  const html = coerceHTMLString(raw);
  return { html };
}

// Streamed chapter expansion for visual, incremental rendering on the chapter screen
export async function* expandChapterStream(req: { context:any; chapterIndex:number; influence?:string; lengthHint?: { range: [number, number]; label: string } }): AsyncGenerator<string, void, unknown>
{
  const res = await fetchWithTimeout(ENDPOINTS.chapter, {
    method: "POST",
    headers:
    {
      "Content-Type": "application/json",
      "Accept": "application/x-ndjson, text/event-stream;q=0.9, text/plain;q=0.8, */*;q=0.1",
      "Authorization": basicAuthHeader(),
    },
    body: JSON.stringify(withSession(req))
  });

  if (!res.ok)
  {
    const t = await res.text().catch(()=>"");
    throw new Error(t || `Endpoint error ${res.status}`);
  }

  const contentType = res.headers.get("content-type") || "";
  const reader = res.body?.getReader();
  if (!reader)
  {
    // Fallback to non-streaming if the platform/browser does not support it
    const fallback = await res.text();
    yield fallback;
    return;
  }

  const decoder = new TextDecoder();
  let buffered = "";
  const isSSE = /text\/event-stream/i.test(contentType);

  while (true)
  {
    const { value, done } = await reader.read();
    if (done) { break; }
    const chunk = decoder.decode(value, { stream: true });
    if (!chunk) { continue; }

    if (isSSE)
    {
      // SSE parsing: lines beginning with data:
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() || "";
      for (const line of lines)
      {
        if (!line.startsWith("data:")) { continue; }
        const data = line.slice(5).trimStart();
        if (!data || data === "[DONE]") { continue; }
        try
        {
          const obj = JSON.parse(data);
          if (obj && obj.type === "item" && typeof obj.content === "string")
          {
            yield obj.content;
          }
          else if (typeof obj === 'string')
          {
            yield obj;
          }
        }
        catch
        {
          // If not JSON payload, treat as raw text
          yield data + "\n";
        }
      }
      continue;
    }

    // NDJSON or whitespace-delimited JSON objects
    // Normalize boundaries like `}{` across chunks into separate lines
    buffered += chunk;
    buffered = buffered.replace(/}\s*\{/g, "}\n{");
    const parts = buffered.split(/\r?\n/);
    buffered = parts.pop() || "";
    for (const part of parts)
    {
      const line = part.trim();
      if (!line) { continue; }
      // Some streams may concatenate multiple JSONs on one line; split again conservatively
      const maybeMany = line.replace(/}\s*\{/g, "}\n{").split(/\r?\n/);
      for (const token of maybeMany)
      {
        const t = token.trim();
        if (!t || t === "[DONE]") { continue; }
        try
        {
          const obj = JSON.parse(t);
          if (obj?.type === "item" && typeof obj.content === "string")
          {
            yield obj.content;
          }
          else if (typeof obj === 'string')
          {
            yield obj;
          }
          // ignore begin/end/metadata frames silently
        }
        catch
        {
          // Not a full JSON yet; push back into buffer
          buffered = t;
        }
      }
    }
  }

  // Attempt to parse any trailing buffered JSON token
  const tail = (buffered || "").trim();
  if (tail && tail !== "[DONE]")
  {
    try
    {
      const obj = JSON.parse(tail);
      if (obj?.type === "item" && typeof obj.content === "string")
      {
        yield obj.content;
      }
      else if (typeof obj === 'string')
      {
        yield obj;
      }
    } catch { /* swallow */ }
  }
}
async function postForImageUrl(url: string, payload: any): Promise<string>
{
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": basicAuthHeader(),
    },
    body: JSON.stringify(withSession(payload))
  });
  const contentType = res.headers.get("content-type") || "";
  if (!res.ok)
  {
    const t = await res.text().catch(()=>"");
    throw new Error(t || `Endpoint error ${res.status}`);
  }
  // If direct image bytes
  if (contentType.startsWith("image/"))
  {
    const blob = await res.blob();
    // Create a blob URL for immediate display in the browser
    return URL.createObjectURL(blob);
  }
  // If JSON with { url } or { data }
  const text = await res.text();
  try {
    const obj = JSON.parse(text);
    if (typeof obj?.url === 'string') return obj.url;
    if (typeof obj?.data === 'string')
    {
      const guessedType = obj?.mime || obj?.type || 'image/png';
      // If data already contains a data: URL, return as is
      if (obj.data.startsWith('data:')) return obj.data;
      return `data:${guessedType};base64,${obj.data}`;
    }
  } catch {}
  // Otherwise assume response body is a URL string
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty response");
  return trimmed;
}

export async function genImage(prompt: string){ return { url: await postForImageUrl(ENDPOINTS.image, { prompt }) }; }

async function postForAudioUrl(url: string, payload: any): Promise<string>
{
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": basicAuthHeader(),
    },
    body: JSON.stringify(withSession(payload))
  });
  const contentType = res.headers.get("content-type") || "";
  if (!res.ok)
  {
    const t = await res.text().catch(()=>"");
    throw new Error(t || `Endpoint error ${res.status}`);
  }
  // If direct audio bytes
  if (/^audio\//i.test(contentType))
  {
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }
  // Otherwise try to parse structured response first
  const text = await res.text();
  try {
    const obj = JSON.parse(text);
    // Common patterns: { url }, { data, mime }
    if (typeof obj?.url === 'string') { return obj.url; }
    if (typeof obj?.data === 'string')
    {
      const guessedType = obj?.mime || obj?.type || 'audio/mpeg';
      if (obj.data.startsWith('data:')) { return obj.data; }
      return `data:${guessedType};base64,${obj.data}`;
    }
  } catch {}
  // Fallback: assume plain URL string
  const trimmed = text.trim();
  if (!trimmed) { throw new Error("Empty response"); }
  return trimmed;
}

export async function voiceforge(prompt: string): Promise<{ url: string }>
{
  const url = await postForAudioUrl(ENDPOINTS.voice, { prompt });
  return { url };
}
export async function exportBook(book: { htmlPages?:string[]; scenes?: { chapterId:number; chapterHeading:string; html:string; imageUrl?:string|null }[]; coverUrl?:string|null; meta:any })
{
  // Primary path: generate a standalone HTML file client-side from in-memory content
  try
  {
    const { htmlPages, scenes: sceneItems, coverUrl, meta } = book || ({} as any);
    const title = (meta?.title || "Untitled Codex").toString();
    const safeTitle = title.replace(/[^a-z0-9\- _\(\)\[\]]+/gi, "_").trim() || "storybook";

    const chaptersMeta = Array.isArray(meta?.chapters) ? meta.chapters : [];

    // Helper: convert blob: URLs to data URLs so they survive in a standalone file
    async function ensureEmbeddableUrl(possibleUrl: string | null | undefined): Promise<string | null>
    {
      const url = (possibleUrl || '').toString();
      if (!url) { return null; }
      if (!url.startsWith('blob:')) { return url; }
      try {
        const resp = await fetch(url);
        const blob = await resp.blob();
        const dataUrl: string = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        return dataUrl;
      } catch { return null; }
    }

    const chaptersForExportRaw: { id:number; heading:string; html:string; imageUrl?:string|null }[] = Array.isArray(sceneItems) && sceneItems.length
      ? sceneItems.map(s => ({ id: s.chapterId, heading: s.chapterHeading, html: s.html, imageUrl: s.imageUrl }))
      : (Array.isArray(htmlPages) ? htmlPages : []).map((html, i) => ({
          id: (chaptersMeta[i]?.id ?? (i + 1)),
          heading: (chaptersMeta[i]?.heading ?? `Chapter ${i + 1}`),
          html,
          imageUrl: null,
        }));

    const chaptersForExport = await Promise.all(chaptersForExportRaw.map(async ch => ({
      ...ch,
      imageUrl: await ensureEmbeddableUrl(ch.imageUrl)
    })));

    const embeddableCoverUrl = await ensureEmbeddableUrl(coverUrl);
    const coverImg = embeddableCoverUrl ? `<img src="${embeddableCoverUrl}" alt="Cover" style="max-width:100%;height:auto;border:1px solid #e2c084;border-radius:12px;margin:12px 0;"/>` : "";

    const tocList = chaptersForExport.length
      ? `<section class="toc card">
  <h2>Table of Contents</h2>
  <ol class="toc-list">
    ${chaptersForExport.map(ch => `<li><a href="#chapter-${ch.id}">${ch.id}. ${escapeHtml(ch.heading)}</a></li>`).join("\n    ")}
  </ol>
</section>`
      : "";

    const chaptersHtml = chaptersForExport.map(ch => `
<article class="chapter" id="chapter-${ch.id}">
  <h2 class="chapter-title">Chapter ${ch.id}: ${escapeHtml(ch.heading)}</h2>
  ${ch.imageUrl ? `<img src="${ch.imageUrl}" alt="Chapter ${ch.id} image" />` : ""}
  <div class="prose dropcap">${ch.html}</div>
</article>`).join("\n\n<hr/>\n\n");

    const doc = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=Crimson+Text:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
  <style>
    body { color:#451a03; background:#fffbeb; font-family: 'Crimson Text', ui-serif, Georgia, Cambria, "Times New Roman", Times, serif; margin: 24px; font-size: 18px; line-height: 1.85; }
    h1, h2, h3 { font-family: 'IM Fell English', ui-serif, Georgia, Cambria, "Times New Roman", Times, serif; color:#7c2d12; }
    .container { max-width: 780px; margin: 0 auto; }
    .card { background: rgba(255, 237, 213, 0.6); border: 1px solid #fdba74; border-radius: 16px; padding: 16px; }
    .meta { color:#92400e; font-size: 0.9rem; }
    hr { border:0; border-top:1px solid #fed7aa; margin: 24px 0; }
    .chapter { margin: 16px 0; }
    .chapter img { max-width:100%; height:auto; border-radius: 8px; border:1px solid #fcd34d; }
    .prose p { line-height: 1.85; margin: 10px 0; font-size: 1.05em; }
    .toc-list { margin: 8px 0 0 20px; }
    .toc-list li { margin: 6px 0; }
    .chapter-title { margin-bottom: 8px; color:#7c2d12; font-size: 1.8rem; }
    /* Drop cap for first paragraph */
    .dropcap p:first-of-type::first-letter { float:left; font-family: 'IM Fell English', ui-serif, Georgia, Cambria, "Times New Roman", Times, serif; font-size: 3.2rem; line-height: 1; padding-right: 0.22rem; padding-top: 0.12rem; font-weight: 700; color:#7c2d12; }
  </style>
  <meta name="generator" content="Storyforge" />
  <meta name="description" content="Exported Storyforge book" />
  <meta name="author" content="Storyforge" />
  <meta name="storyforge:title" content="${title}" />
  <meta name="storyforge:chapters" content="${(meta?.chapters?.length || 0).toString()}" />
  <script>/* Standalone export generated locally without server dependency */</script>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='14' font-size='14'>📜</text></svg>">
  <meta name="color-scheme" content="light" />
  <meta name="theme-color" content="#f59e0b" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="${title}" />
  <meta name="format-detection" content="telephone=no" />
  <meta name="mobile-web-app-capable" content="yes" />
</head>
<body>
  <main class="container">
    <div class="card">
      <h1>${title}</h1>
      ${coverImg}
    </div>
    ${tocList}
    <section class="chapters">
      ${chaptersHtml}
    </section>
  </main>
</body>
</html>`;

    const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    return { downloadUrl: url, filename: `${safeTitle}.html` } as any;
  }
  catch
  {
    // If anything goes wrong with local generation, fall back to remote export (best-effort)
    try { return { downloadUrl: await postForText(ENDPOINTS.export, book) }; }
    catch { return { downloadUrl: null }; }
  }
}

// Send full package to server for archival/export
export async function exportStoryPackage(book: { htmlPages?:string[]; scenes?: { chapterId:number; chapterHeading:string; html:string; imageUrl?:string|null }[]; coverUrl?:string|null; meta:any }): Promise<void>
{
  try
  {
    // Normalize payload shape
    const title = (book?.meta?.title || "Untitled Codex").toString();
    const payload = {
      title,
      toc: book?.meta?.toc ?? null,
      chapters: Array.isArray(book?.meta?.chapters) ? book.meta.chapters : [],
      scenes: Array.isArray(book?.scenes) ? book.scenes : [],
      coverUrl: book?.coverUrl ?? null,
      htmlPages: Array.isArray(book?.htmlPages) ? book.htmlPages : undefined,
      exportedAt: new Date().toISOString(),
    };
    await fetchWithTimeout(ENDPOINTS.exportStory, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": basicAuthHeader(),
      },
      body: JSON.stringify(withSession(payload))
    }).then(()=>{}).catch(()=>{});
  }
  catch
  {
    // Best-effort; ignore errors to not block client export UX
  }
}

export type PrimeInfo = {
  title?: string;
  description?: string;
  ageRange?: string;
  genre?: string;
  chapters?: number;
  chapterLength?: string;
  keypoints?: string;
  style?: string;
  toc?: string;
};

// Attempt to parse tuple-style outputs like: ({ ... }),({ ... }), and return the first viable object
function parsePrimeTupleString(raw: string): PrimeInfo | null
{
  const s = (raw || "").toString().trim();
  if (!s)
  {
    return null;
  }
  // Extract JSON objects wrapped in parentheses, optionally comma-separated
  // Example: ( {"title":"..."} ),( {"title":"..."} ),
  const re = /\(\s*({[\s\S]*?})\s*\)\s*,?/g;
  const candidates: any[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null)
  {
    const jsonCandidate = (m[1] || "").trim();
    try
    {
      const obj = JSON.parse(jsonCandidate);
      if (obj && typeof obj === 'object')
      {
        candidates.push(obj);
      }
    }
    catch {}
  }
  if (!candidates.length)
  {
    return null;
  }
  // Map the first candidate to PrimeInfo shape
  const first = candidates[0] || {};
  const info: PrimeInfo = {
    title: first.title,
    description: first.description,
    ageRange: first.ageRange,
    genre: first.genre,
    chapters: typeof first.chapters === 'number' ? first.chapters : (parseInt(String(first.chapters || ''), 10) || undefined),
    chapterLength: first.chapterLength,
    keypoints: first.keypoints,
    style: first.style,
  };
  const hasSignal = Object.values(info).some(v => v !== undefined && v !== null && v !== "");
  return hasSignal ? info : null;
}

export async function primeStory(input: { prompt?: string; premise?: string }): Promise<{ info: PrimeInfo }>
{
  // Try JSON first; if not JSON, treat raw text as description
  try {
    const rawObj = await postForJson<any>(ENDPOINTS.prime, input);

    // Helper to parse an output string into PrimeInfo (handles fences and parentheses)
    const parseOutputString = (outStr: string): PrimeInfo => {
      const out = (outStr || '').trim();
      // First, attempt tuple-style parsing like: ({ ... }),({ ... }),
      const tuple = parsePrimeTupleString(out);
      if (tuple)
      {
        return tuple;
      }
      // Extract fenced code if present
      const fenceMatch = out.match(/```\s*json\s*([\s\S]*?)```/i) || out.match(/```\s*([\s\S]*?)```/i);
      let jsonCandidate = (fenceMatch ? fenceMatch[1] : out).trim();
      // Strip wrapping parentheses if present
      jsonCandidate = jsonCandidate.replace(/^\s*\(\s*/, '').replace(/\s*\)\s*$/, '');
      try {
        const parsed = JSON.parse(jsonCandidate);
        if (parsed && typeof parsed === 'object')
        {
          const info: PrimeInfo = {
            title: parsed.title,
            description: parsed.description,
            ageRange: parsed.ageRange,
            genre: parsed.genre,
            chapters: parsed.chapters,
            chapterLength: parsed.chapterLength,
            keypoints: parsed.keypoints,
            style: parsed.style,
          };
          if (Object.values(info).some(v => v !== undefined && v !== null && v !== '')) return info;
        }
      } catch {}
      // Fallback: detect TOC vs description
      const lines: string[] = out.split(/\r?\n/).filter(Boolean);
      const looksLikeTOC = lines.length >= 3 && lines.slice(0,3).every((l: string) => /^(\s*(\d+[\).]|[•\-*])\s*)?/.test(l));
      if (looksLikeTOC) { return { toc: out }; }
      return { description: out };
    };

    // Some agents return [{ output: "..." }]
    if (Array.isArray(rawObj) && rawObj.length > 0)
    {
      const first = rawObj[0];
      if (typeof first?.output === 'string')
      {
        const info = parseOutputString(first.output);
        return { info };
      }
      // Or already JSON object
      if (first && typeof first === 'object') return { info: first as PrimeInfo };
    }

    // Some agents return { output: "..." }
    if (typeof rawObj?.output === 'string')
    {
      const info = parseOutputString(rawObj.output);
      return { info };
    }

    return { info: rawObj as PrimeInfo };
  } catch {
    try {
      const raw = await postForRaw(ENDPOINTS.prime, input);
      const desc = (raw || "").toString().trim();
      // Attempt to parse tuple-style "({ ... }),({ ... })," first
      const tupleInfo = parsePrimeTupleString(desc);
      if (tupleInfo)
      {
        return { info: tupleInfo };
      }
      return { info: desc ? { description: desc } : {} };
    } catch (e) {
      throw e;
    }
  }
}


