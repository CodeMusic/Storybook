export const BASE = process.env.NEXT_PUBLIC_N8N_BASE || "https://n8n.codemusic.ca/webhook";
const N8N_USER = process.env.NEXT_PUBLIC_N8N_USER || "siteuser";
const N8N_PASS = process.env.NEXT_PUBLIC_N8N_PASS || "codemusai";
const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes for local models
export const ENDPOINTS = {
  prime: `${BASE}/seedInfo`,        // → JSON basic info from prompt
  seed: `${BASE}/seedStory`,        // → string TOC
  chapter: `${BASE}/expandChapter`, // → string HTML
  image: `${BASE}/genImage`,        // → string image URL
  export: `${BASE}/exportBook`,     // → string download URL
};

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

async function postForText(url: string, payload: any): Promise<string> {
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": basicAuthHeader(),
    },
    body: JSON.stringify(payload)
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
    body: JSON.stringify(payload)
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
    body: JSON.stringify(payload)
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

function escapeHtml(unsafe: string): string
{
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function coerceHTMLString(raw: string): string
{
  const text = (raw || "").toString().trim();
  if (!text) return "";
  // Try JSON parsing first and extract common fields
  try {
    const obj = JSON.parse(text);
    if (Array.isArray(obj) && obj.length > 0)
    {
      const first = obj[0] as any;
      if (typeof first?.html === 'string') return first.html;
      if (typeof first?.output === 'string') return coerceHTMLString(first.output);
    }
    if (typeof obj === 'object' && obj)
    {
      if (typeof (obj as any).html === 'string') return (obj as any).html;
      if (typeof (obj as any).output === 'string') return coerceHTMLString((obj as any).output);
    }
  } catch {}
  // If it already looks like HTML, return as-is
  if (/[<][a-zA-Z!/?]/.test(text)) return text;
  // Basic plaintext/markdown to HTML: paragraphs and line breaks
  const blocks = text.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
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
    console.log('DEBUG seedStory: parsed toc =', toc);
    return { toc };
  } catch (error) {
    console.error('DEBUG seedStory: error =', error);
    throw error;
  }
}
export async function expandChapter(req: { context:any; chapterIndex:number; influence?:string })
{
  const raw = await postForText(ENDPOINTS.chapter, req);
  const html = coerceHTMLString(raw);
  return { html };
}
async function postForImageUrl(url: string, payload: any): Promise<string>
{
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": basicAuthHeader(),
    },
    body: JSON.stringify(payload)
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
export async function exportBook(book: { htmlPages:string[]; coverUrl?:string|null; meta:any }) {
  try { return { downloadUrl: await postForText(ENDPOINTS.export, book) }; }
  catch { return { downloadUrl: null }; }
}

export type PrimeInfo = {
  title?: string;
  description?: string;
  ageRange?: string;
  genre?: string;
  chapters?: number;
  keypoints?: string;
  style?: string;
  toc?: string;
};

export async function primeStory(input: { prompt?: string; premise?: string }): Promise<{ info: PrimeInfo }>
{
  // Try JSON first; if not JSON, treat raw text as description
  try {
    const rawObj = await postForJson<any>(ENDPOINTS.prime, input);

    // Helper to parse an output string into PrimeInfo (handles fences and parentheses)
    const parseOutputString = (outStr: string): PrimeInfo => {
      const out = (outStr || '').trim();
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
      return { info: desc ? { description: desc } : {} };
    } catch (e) {
      throw e;
    }
  }
}


