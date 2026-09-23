// Deliberate maintainer operation only. The application never calls OSM/Overpass for geometry.
import { readFile, writeFile, mkdir } from "node:fs/promises";
const mapping = JSON.parse(await readFile("data/geography/district-mapping.json", "utf8"));
const ids = [...mapping.map((m) => Number(m.mapFeatureId.split("/")[1])), 3087155];
const downloaded = [];
const manifest = { retrievedAt: new Date().toISOString(), provider: "OpenStreetMap API 0.6", license: "ODbL-1.0", objects: [] };
for (const id of ids) {
  const url = `https://www.openstreetmap.org/api/0.6/relation/${id}/full.json`;
  const response = await fetch(url, { headers: { "User-Agent": "CITYPROOF/0.1 (https://github.com/BAITC-Hacks/hack-8d88351c-eam-trinity)" }, signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`OSM ${response.status}: ${id}`);
  const data = await response.json();
  const relation = data.elements.find((e) => e.type === "relation" && e.id === id);
  if (!relation || relation.tags.boundary !== "administrative") throw new Error(`Invalid relation: ${id}`);
  downloaded.push([id, data]);
  manifest.objects.push({ id, url, version: relation.version, timestamp: relation.timestamp, tags: relation.tags, elements: data.elements.length, latestMemberEdit: data.elements.map((e) => e.timestamp).sort().at(-1) });
}
// Do not replace any saved input until all seven requests have succeeded.
await mkdir("data/geography/source", { recursive: true });
for (const [id, data] of downloaded) await writeFile(`data/geography/source/relation-${id}.json`, JSON.stringify(data) + "\n");
await writeFile("data/geography/source/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log("Downloaded seven OSM relations. Run npm run geo:prepare and review the geometry report before publishing.");
