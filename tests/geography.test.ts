import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { booleanValid } from "@turf/boolean-valid";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { intersect } from "@turf/intersect";
import { area } from "@turf/area";
import { union } from "@turf/union";
import {
  districts,
  mapValue,
  metricColor,
  districtStyle,
  type DistrictCollection,
  type DistrictFeature,
} from "../src/lib/map/geography";
import {
  model,
  computeBaseline,
  evaluateScenario,
  runStress,
} from "../src/lib/model/engine";
import report from "../data/geography/validation.json";

const data = JSON.parse(
  readFileSync("public/geography/astana-districts.geojson", "utf8"),
) as DistrictCollection;
const city = JSON.parse(
  readFileSync("public/geography/astana-city.geojson", "utf8"),
) as DistrictFeature;
describe("saved Astana geography", () => {
  it("maps exactly six unique OSM relations to five unchanged model IDs and one null", () => {
    expect(new Set(data.features.map((f) => f.id)).size).toBe(6);
    expect(data.features.map((f) => f.id).sort()).toEqual(
      districts.map((d) => d.mapFeatureId).sort(),
    );
    expect(
      districts
        .flatMap((d) => (d.modelDistrictId ? [d.modelDistrictId] : []))
        .sort(),
    ).toEqual(model.districts.map((d) => d.id).sort());
    expect(districts.find((d) => d.modelDistrictId === null)).toMatchObject({
      mapFeatureId: "relation/19733918",
      name: "Сарайшық",
    });
    for (const f of data.features)
      expect(f.properties.modelDistrictId).toBe(
        districts.find((d) => d.mapFeatureId === f.id)?.modelDistrictId,
      );
  });
  for (const feature of data.features)
    it(`${feature.properties.name}: valid polygon, closed rings, interior label and Astana containment`, () => {
      expect(["Polygon", "MultiPolygon"]).toContain(feature.geometry.type);
      expect(booleanValid(feature)).toBe(true);
      expect(
        booleanPointInPolygon(feature.properties.label, feature, {
          ignoreBoundary: true,
        }),
      ).toBe(true);
      const parts =
        feature.geometry.type === "Polygon"
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates;
      for (const polygon of parts)
        for (const ring of polygon) {
          expect(ring.length).toBeGreaterThanOrEqual(4);
          expect(ring[0]).toEqual(ring.at(-1));
          for (const [lng, lat] of ring) {
            expect(lng).toBeGreaterThan(71);
            expect(lng).toBeLessThan(72);
            expect(lat).toBeGreaterThan(50.7);
            expect(lat).toBeLessThan(51.5);
          }
        }
      const contained = intersect({
        type: "FeatureCollection",
        features: [feature, city],
      });
      expect(contained).not.toBeNull();
      expect(Math.abs(area(feature) - area(contained!))).toBeLessThan(1);
    });
  it("preserves non-overlapping districts and reports the actual uncovered city fragment", () => {
    data.features.forEach((a, i) =>
      data.features.slice(i + 1).forEach((b) => {
        const shared = intersect({
          type: "FeatureCollection",
          features: [a, b],
        });
        expect(shared ? area(shared) : 0).toBeLessThan(1);
      }),
    );
    expect((area(city) - area(union(data)!)) / 1e6).toBeCloseTo(
      report.uncoveredCityAreaKm2,
      5,
    );
    expect(report.uncoveredCityAreaKm2).toBeGreaterThan(10);
  });
  it("keeps exact source snapshots matching the recorded SHA-256 hashes", () => {
    for (const [file, digest] of Object.entries(report.sourceHashes))
      expect(
        createHash("sha256")
          .update(readFileSync(`data/geography/source/${file}`))
          .digest("hex"),
      ).toBe(digest);
  });
});
describe("map and synthetic model separation", () => {
  it("shows actual mode values on the same scale and never invents Saraishyq values", () => {
    const baseline = computeBaseline(),
      official = evaluateScenario({
        decisions: model.source_example.decisions,
      }),
      winter = runStress(
        { decisions: model.source_example.decisions },
        "winter_demo",
      );
    if (!official.valid || !winter.valid) throw Error("fixture invalid");
    const before = JSON.stringify([baseline, official.result, winter.result]);
    expect(mapValue("relation/3486954", baseline, "C1")).toBe(45);
    expect(mapValue("relation/3486954", official.result, "C1")).toBe(47.5);
    expect(mapValue("relation/3486954", winter.result, "C1")).toBe(39.5);
    for (const r of [baseline, official.result, winter.result]) {
      expect(mapValue("relation/19733918", r, "C1")).toBeNull();
      expect(Object.keys(r.indicators)).toHaveLength(5);
    }
    expect(metricColor(null)).not.toBe(metricColor(0));
    expect(metricColor(50)).toBe(
      metricColor(mapValue("relation/3482819", baseline, "C1")),
    );
    expect(JSON.stringify([baseline, official.result, winter.result])).toBe(
      before,
    );
  });
  it("encodes hover and selection by outlines without changing the value colour", () => {
    const normal = districtStyle(40, false, false),
      hover = districtStyle(40, false, true),
      selected = districtStyle(40, true, false);
    expect(normal.fillColor).toBe(hover.fillColor);
    expect(hover.fillColor).toBe(selected.fillColor);
    expect(new Set([normal.weight, hover.weight, selected.weight]).size).toBe(
      3,
    );
    expect(districtStyle(40, true, true)).toEqual(selected);
    expect(districtStyle(null, false, false).dashArray).toBeDefined();
  });
});
