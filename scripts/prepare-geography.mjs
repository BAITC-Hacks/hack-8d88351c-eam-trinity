import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import osmToGeoJSON from "osmtogeojson";
import polylabel from "polylabel";
import { booleanValid } from "@turf/boolean-valid";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { area } from "@turf/area";
import { intersect } from "@turf/intersect";
import { union } from "@turf/union";

const mapping = JSON.parse(await readFile("data/geography/district-mapping.json", "utf8"));
const manifest = JSON.parse(await readFile("data/geography/source/manifest.json", "utf8"));
const model = JSON.parse(await readFile("hackalem_model.json", "utf8"));
assert.equal(mapping.length, 6);
assert.deepEqual(mapping.flatMap((m) => m.modelDistrictId ? [m.modelDistrictId] : []).sort(), model.districts.map((d) => d.id).sort());
assert.equal(mapping.filter((m) => m.modelDistrictId === null).length, 1);
const hashes = {}, seen = new Map(), features = [];
const collection = (features) => ({ type: "FeatureCollection", features });
const hash = (text) => createHash("sha256").update(text).digest("hex");
for (const source of manifest.objects) {
  const text = await readFile(`data/geography/source/relation-${source.id}.json`, "utf8");
  hashes[`relation-${source.id}.json`] = hash(text);
  const raw = JSON.parse(text);
  for (const e of raw.elements) {
    const key = `${e.type}/${e.id}`;
    if (seen.has(key)) assert.equal(JSON.stringify(e), seen.get(key), `Inconsistent shared OSM object: ${key}`);
    seen.set(key, JSON.stringify(e));
  }
  const f = osmToGeoJSON(raw).features.find((f) => f.id === `relation/${source.id}`);
  assert(f && !f.properties.tainted, `Missing/incomplete geometry: ${source.id}`);
  assert(["Polygon", "MultiPolygon"].includes(f.geometry.type));
  assert(booleanValid(f), `Invalid geometry: ${f.id}`);
  const polygons = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const polygon of polygons) for (const ring of polygon) {
    assert(ring.length >= 4);
    assert.deepEqual(ring[0], ring.at(-1));
    for (const [lng, lat] of ring) assert(Number.isFinite(lng) && Number.isFinite(lat) && lng > 71 && lng < 72 && lat > 50.7 && lat < 51.5, `Outside Astana coordinate range: ${f.id}`);
  }
  const link = mapping.find((m) => m.mapFeatureId === f.id);
  const properties = { mapFeatureId: f.id, name: link?.name ?? "Астана", modelDistrictId: link?.modelDistrictId ?? null, sourceName: source.tags.name, sourceNameRu: source.tags["name:ru"], relationId: source.id, relationVersion: source.version, relationTimestamp: source.timestamp, latestMemberEdit: source.latestMemberEdit, retrievedAt: manifest.retrievedAt, areaKm2: area(f) / 1e6 };
  // Find an interior label point on the largest component in Mercator metres.
  const largest = polygons.toSorted((a, b) => area({ type: "Polygon", coordinates: b }) - area({ type: "Polygon", coordinates: a }))[0];
  const project = ([lng, lat]) => [lng * Math.PI / 180 * 6378137, Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 6378137];
  const p = polylabel(largest.map((ring) => ring.map(project)), 2);
  const label = [p[0] / 6378137 * 180 / Math.PI, (2 * Math.atan(Math.exp(p[1] / 6378137)) - Math.PI / 2) * 180 / Math.PI];
  assert(booleanPointInPolygon(label, f, { ignoreBoundary: true }));
  features.push({ type: "Feature", id: f.id, properties: { ...properties, label }, geometry: f.geometry });
}
const city = features.find((f) => f.id === "relation/3087155");
const districts = mapping.map((m) => features.find((f) => f.id === m.mapFeatureId));
const report = { retrievedAt: manifest.retrievedAt, validation: "Valid Polygon/MultiPolygon; rings closed; Astana coordinates; labels inside; consistent shared OSM objects", districts: districts.map((f) => f.properties), pairwiseOverlapKm2: [], cityAreaKm2: area(city) / 1e6, uncoveredCityAreaKm2: 0, sourceHashes: hashes };
for (let i = 0; i < districts.length; i++) {
  const a = districts[i], inside = intersect(collection([a, city]));
  assert(inside && Math.abs(area(a) - area(inside)) < 1, `Not contained by Astana: ${a.id}`);
  for (let j = i + 1; j < districts.length; j++) {
    const b = districts[j], overlap = intersect(collection([a, b]));
    const squareMetres = overlap ? area(overlap) : 0;
    assert(squareMetres < 1, `Overlapping districts: ${a.id}, ${b.id}`);
    report.pairwiseOverlapKm2.push({ a: a.id, b: b.id, area: squareMetres / 1e6 });
  }
}
report.uncoveredCityAreaKm2 = (area(city) - area(union(collection(districts)))) / 1e6;
assert(report.uncoveredCityAreaKm2 >= -0.001);
// Keep raw source geometry unchanged: no simplification, union into neighbours, or invented missing boundaries.
await mkdir("public/geography", { recursive: true });
await writeFile("public/geography/astana-districts.geojson", JSON.stringify(collection(districts)) + "\n");
await writeFile("public/geography/astana-city.geojson", JSON.stringify(city) + "\n");
await writeFile("data/geography/validation.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ districts: districts.length, validation: report.validation, uncoveredCityAreaKm2: report.uncoveredCityAreaKm2 }));
