// Finds one embeddable YouTube "how to" video for every exercise in
// src/data/exerciseList.json and writes src/data/exerciseVideos.json.
// Run: node scripts/fetch-exercise-videos.mjs   (re-run any time to refresh)
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const list = JSON.parse(await readFile(path.join(root, 'src/data/exerciseList.json'), 'utf8'));
const outPath = path.join(root, 'src/data/exerciseVideos.json');
let existing = {};
try { existing = JSON.parse(await readFile(outPath, 'utf8')); } catch {}
const force = process.argv.includes('--force');

const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 4) {
  for (let i = 0; ; i++) {
    try { return await fetch(url, { headers: UA }); }
    catch (e) { if (i >= tries) throw e; await sleep(2000 * 2 ** i); }
  }
}

async function candidates(name) {
  const q = encodeURIComponent(`how to do ${name} proper form tutorial`);
  const html = await (await get(`https://www.youtube.com/results?search_query=${q}&sp=EgIQAQ%253D%253D`)).text();
  const ids = [...html.matchAll(/"videoRenderer":\{"videoId":"([\w-]{11})"/g)].map((m) => m[1]);
  return [...new Set(ids)].slice(0, 8);
}

async function oembed(id) {
  const r = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`);
  if (!r.ok) return null; // 401/403 => embedding disabled, 404 => gone
  return r.json();
}

const out = {};
const used = new Set();
for (const [day, { exercises }] of Object.entries(list)) {
  for (const name of exercises) {
    const key = `${day}:${name}`;
    if (!force && existing[key] && !used.has(existing[key].videoId)) { out[key] = existing[key]; used.add(existing[key].videoId); continue; }
    let found = null;
    for (const id of await candidates(name)) {
      if (used.has(id)) continue;
      const meta = await oembed(id);
      if (meta) { used.add(id); found = { videoId: id, title: meta.title, channel: meta.author_name }; break; }
    }
    out[key] = found;
    console.log(found ? `✓ ${key} -> ${found.videoId} (${found.title})` : `✗ ${key}`);
    await writeFile(outPath, JSON.stringify({ ...existing, ...out }, null, 2) + '\n');
    await sleep(800);
  }
}
await writeFile(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${Object.keys(out).length} entries to ${path.relative(root, outPath)}`);
