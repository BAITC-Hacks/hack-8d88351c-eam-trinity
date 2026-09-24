import mapping from "../../../data/geography/district-mapping.json";
import type { DistrictId, MetricId, Result } from "../model/engine";
import type {
  Feature,
  FeatureCollection,
  Polygon,
  MultiPolygon,
} from "geojson";

export const districts = mapping as {
  mapFeatureId: string;
  modelDistrictId: DistrictId | null;
  name: string;
}[];
export const sourceDate = "23.09.2026";
export type DistrictProperties = {
  mapFeatureId: string;
  modelDistrictId: DistrictId | null;
  name: string;
  label: [number, number];
  relationId: number;
  relationVersion: number;
  relationTimestamp: string;
};
export type DistrictFeature = Feature<
  Polygon | MultiPolygon,
  DistrictProperties
>;
export type DistrictCollection = FeatureCollection<
  Polygon | MultiPolygon,
  DistrictProperties
>;
export const districtForFeature = (id: string) =>
  districts.find((d) => d.mapFeatureId === id);
export const featureForDistrict = (id: DistrictId | null) =>
  districts.find((d) => d.modelDistrictId === id)!;
export function mapValue(
  id: string,
  result: Result,
  metric: MetricId,
): number | null {
  const modelId = districtForFeature(id)?.modelDistrictId;
  return modelId ? result.indicators[modelId][metric] : null;
}
// Fixed 0–100 scale shared by every district, indicator and result mode.
export function metricColor(value: number | null) {
  if (value === null) return "#f1f3f6";
  const t = Math.max(0, Math.min(100, value)) / 100;
  const a = [232, 241, 255],
    b = [40, 100, 189];
  return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(", ")})`;
}
export function districtStyle(
  value: number | null,
  selected: boolean,
  hovered: boolean,
) {
  return {
    fillColor: metricColor(value),
    fillOpacity: value === null ? 0.85 : 0.55,
    color: selected ? "#174cad" : hovered ? "#4884dc" : "#9bb4d4",
    weight: selected ? 4 : hovered ? 3 : 1.4,
    dashArray: value === null && !selected ? "4 4" : undefined,
  };
}

export type MapFocusRequest = {
  id: string;
  featureId: string;
  resultId: string;
  metricId: MetricId;
  evidenceId: string;
};
