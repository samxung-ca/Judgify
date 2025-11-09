import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import multer from "multer";
import pdf from "pdf-parse";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5175;
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Serve frontend (optional convenience)
app.use("/", express.static(path.join(__dirname, "../frontend")));

// --- Helpers ---
function absoluteUrl(href, base){
  try { return new URL(href, base).toString(); } catch { return href; }
}
function extractJson(text){
  const m = text.match(/```json\s*([\s\S]*?)```/i);
  if(m) return m[1];
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if(a !== -1 && b !== -1) return text.slice(a, b+1);
  return text;
}
async function geminiCall({ model, prompt, apiKey }){
  const key = apiKey || process.env.GEMINI_API_KEY;
  if(!key) throw new Error("Missing GEMINI_API_KEY (set in backend .env)");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }]}],
      generationConfig: { temperature: 0.2 }
    })
  });
  if(!resp.ok){
    const t = await resp.text();
    throw new Error(`Gemini error ${resp.status}: ${t.slice(0,400)}`);
  }
  const data = await resp.json();
  const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
  if(!text) throw new Error("Empty Gemini response");
  return text;
}

// --- Scrape Devpost gallery ---
app.get("/api/scrape-devpost", async (req, res)=>{
  const url = req.query.url;
  if(!url) return res.status(400).send("Missing ?url");
  try{
    const page = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }});
    if(!page.ok) throw new Error(`Fetch failed: ${page.status}`);
    const html = await page.text();
    const $ = cheerio.load(html);

    const projects = [];
    $("a").each((_, a)=>{
      const href = $(a).attr("href") || "";
      const name = ($(a).text() || "").trim();
      // Common Devpost patterns: /project/..., /software/...
      if(/\/(project|software)\//i.test(href) && name.length > 2){
        const urlAbs = absoluteUrl(href, url);
        // Avoid dupes and gallery self-links
        if(urlAbs.includes("/project/") || urlAbs.includes("/software/")){
          projects.push({ name, url: urlAbs });
        }
      }
    });

    // Dedup by URL
    const map = new Map();
    for(const p of projects){
      if(!map.has(p.url)) map.set(p.url, p);
    }

    res.json({ projects: Array.from(map.values()) });
  }catch(err){
    res.status(500).send(String(err.message || err));
  }
});

// --- Parse rubric PDF ---
const upload = multer({ storage: multer.memoryStorage() });
app.post("/api/parse-rubric", upload.single("rubric"), async (req, res)=>{
  try{
    const model = req.body.model || "gemini-1.5-pro";
    if(!req.file) return res.status(400).send("No rubric file uploaded");
    const pdfData = await pdf(req.file.buffer);
    const text = pdfData.text || "";

    const prompt = `Extract a scoring rubric from the following PDF text.
Return STRICT JSON ONLY with this schema:
{
  "criteria": [ { "name": string, "weight": number } ]
}
Rules:
- Weights must be numbers that sum to ~1 (normalize if needed).
- Keep names concise.

PDF TEXT:
<<<
${text[:15000]}
>>>`;

    const raw = await geminiCall({ model, prompt });
    const jsonText = extractJson(raw);
    const parsed = JSON.parse(jsonText);
    const criteria = Array.isArray(parsed.criteria) ? parsed.criteria : [];
    res.json({ rubric: criteria });
  }catch(err){
    res.status(500).send(String(err.message || err));
  }
});

// --- Score all projects ---
app.post("/api/score", async (req, res)=>{
  try{
    const { projects, rubric, model } = req.body || {};
    if(!Array.isArray(projects) || !projects.length) return res.status(400).send("Missing projects[]");
    if(!Array.isArray(rubric) || !rubric.length) return res.status(400).send("Missing rubric[]");
    const mdl = model || "gemini-1.5-pro";

    // Fetch each project page and score
    const results = [];
    for(const p of projects){
      try{
        const page = await fetch(p.url, { headers: { "User-Agent": "Mozilla/5.0" }});
        if(!page.ok) throw new Error(`Fetch ${page.status}`);
        const html = await page.text();
        const $ = cheerio.load(html);
        const title = $("h1, h2").first().text().trim() || p.name || "Untitled";
        const desc = [
          $('meta[name="description"]').attr("content") || "",
          $(".large").text() || "",
          $(".main-content, .content, .gallery, article").text() || "",
          $("body").text() || ""
        ].join("\n").replace(/\s+\n/g, "\n");

        const prompt = `You are a fair hackathon judge. Score the project using this rubric.
Return STRICT JSON ONLY with schema:
{
  "items": [ { "name": string, "weight": number, "score": number, "feedback": string } ],
  "total": number
}
Rules:
- score is 0..100 per item.
- total = sum(weight * score) on 0..100 scale.
- Use weights exactly as provided (do not renormalize).

RUBRIC:
${rubric.map(r=>`- ${r.name} | weight: ${r.weight}`).join("\n")}

PROJECT:
Title: ${title}
URL: ${p.url}
Text:
<<<
${desc[:12000]}
>>>`;

        const raw = await geminiCall({ model: mdl, prompt });
        const jsonText = extractJson(raw);
        const payload = JSON.parse(jsonText);
        const items = Array.isArray(payload.items) ? payload.items : [];
        let total = typeof payload.total === "number" ? payload.total : 0;
        if(!total){
          total = items.reduce((s,it)=> s + (Number(it.weight)||0)*(Number(it.score)||0), 0);
        }
        results.push({ name: title, url: p.url, items, total });
      }catch(inner){
        results.push({ name: p.name || "Untitled", url: p.url, items: [], total: 0, error: String(inner.message || inner) });
      }
    }

    // Rank
    results.sort((a,b)=> b.total - a.total);
    res.json({ results });
  }catch(err){
    res.status(500).send(String(err.message || err));
  }
});

app.listen(PORT, ()=>{
  console.log(`Backend running on http://localhost:${PORT}`);
});
