"use client";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { Maximize2, MapPin, Layers2 } from "lucide-react";
import { format, type MetricId, type Result } from "@/lib/model/engine";
import {
  districts,
  sourceDate,
  districtForFeature,
  mapValue,
  districtStyle,
  type DistrictCollection,
  type DistrictFeature,
  type MapFocusRequest,
} from "@/lib/map/geography";

type Props = {
  result: Result;
  metric: MetricId;
  selectedFeatureId: string;
  onSelect: (id: string) => void;
  focusRequest?: MapFocusRequest | null;
  onFocusApplied?: (id: string, applied: boolean) => void;
};
type MapState = {
  map: Leaflet.Map;
  layers: Map<string, Leaflet.GeoJSON>;
  labels: Map<string, Leaflet.Marker>;
  bounds: Leaflet.LatLngBounds;
  tiles: Leaflet.TileLayer;
  update: () => void;
  fit: () => void;
};

export function CityMap(props: Props) {
  const { focusRequest, selectedFeatureId, onFocusApplied } = props;
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<MapState | null>(null);
  const latest = useRef(props);
  const processed = useRef(new Set<string>());
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [tileError, setTileError] = useState(false),
    [basemap, setBasemap] = useState(true);
  const [sources, setSources] = useState(false);
  useEffect(() => {
    latest.current = props;
    instance.current?.update();
  }, [props]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let stopped = false,
      cleanup: (() => void) | undefined;
    const abort = new AbortController();
    async function initialize() {
      const [L, districtsResponse, cityResponse] = await Promise.all([
        import("leaflet"),
        fetch("/geography/astana-districts.geojson", { signal: abort.signal }),
        fetch("/geography/astana-city.geojson", { signal: abort.signal }),
      ]);
      if (!districtsResponse.ok || !cityResponse.ok)
        throw new Error("LOCAL_GEOMETRY_UNAVAILABLE");
      const data = (await districtsResponse.json()) as DistrictCollection;
      const city = (await cityResponse.json()) as DistrictFeature;
      if (
        data.features.length !== 6 ||
        new Set(data.features.map((f) => f.id)).size !== 6 ||
        data.features.some((f) => !districtForFeature(String(f.id)))
      )
        throw new Error("INVALID_GEOMETRY_SET");
      if (stopped || !element) return;
      const map = L.map(element, {
        zoomControl: false,
        attributionControl: true,
        zoomSnap: 0.25,
        minZoom: 8,
        maxZoom: 17,
        scrollWheelZoom: true,
        zoomAnimation: false,
        fadeAnimation: false,
      });
      cleanup = () => {
        map.off();
        map.remove();
        instance.current = null;
      };
      const layers = new Map<string, Leaflet.GeoJSON>(),
        labels = new Map<string, Leaflet.Marker>();
      L.control
        .zoom({
          position: "topleft",
          zoomInTitle: "Приблизить",
          zoomOutTitle: "Отдалить",
        })
        .addTo(map);
      map.attributionControl.setPrefix("Leaflet");
      map.attributionControl.addAttribution(
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · ODbL',
      );
      map.createPane("quiet-base");
      map.getPane("quiet-base")!.style.zIndex = "200";
      const tiles = L.tileLayer(
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          pane: "quiet-base",
          maxZoom: 19,
          keepBuffer: 0,
          updateWhenIdle: true,
          referrerPolicy: "strict-origin-when-cross-origin",
        },
      );
      let failed = false;
      tiles.on("loading", () => {
        failed = false;
      });
      tiles.on("tileerror", () => {
        failed = true;
        setTileError(true);
      });
      tiles.on("load", () => {
        setTileError(failed);
      });
      tiles.addTo(map);
      const cityLayer = L.geoJSON(city, {
        interactive: false,
        style: {
          color: "#8a98ac",
          weight: 1.5,
          dashArray: "5 5",
          fillOpacity: 0,
        },
      }).addTo(map);
      const bounds = cityLayer.getBounds();
      const fit = () =>
        map.fitBounds(bounds, {
          paddingTopLeft: [28, 22],
          paddingBottomRight: [28, 35],
          animate: false,
        });
      let hovered: string | null = null;
      const update = () => {
        const current = latest.current;
        for (const [id, layer] of layers) {
          layer.eachLayer((part) => {
            if (part instanceof L.Path)
              part.getElement()?.setAttribute("data-feature-id", id);
          });
          const selected = current.selectedFeatureId === id;
          const value = mapValue(id, current.result, current.metric);
          layer.setStyle(districtStyle(value, selected, hovered === id));
          const markerElement = labels.get(id)?.getElement();
          if (markerElement) {
            const button = markerElement.querySelector("button")!;
            button.classList.toggle("selected", selected);
            button.classList.toggle("compact", map.getZoom() < 11);
            button.setAttribute("aria-pressed", String(selected));
            button.setAttribute(
              "aria-label",
              `Район ${districtForFeature(id)!.name}${value === null ? ": нет учебных данных" : `, ${current.metric}: ${format(value)}`}`,
            );
            markerElement.querySelector(".map-label-value")!.textContent =
              value === null
                ? "Нет данных"
                : `${current.metric} · ${format(value)}`;
          }
          if (selected) layer.bringToFront();
        }
      };
      for (const feature of data.features) {
        const id = String(feature.id),
          link = districtForFeature(id)!;
        const layer = L.geoJSON(feature).addTo(map);
        layer.on("click", () => latest.current.onSelect(id));
        layer.on("mouseover", () => {
          hovered = id;
          update();
        });
        layer.on("mouseout", () => {
          hovered = null;
          update();
        });
        layers.set(id, layer);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "map-district-label";
        button.dataset.featureId = id;
        const name = document.createElement("strong"),
          value = document.createElement("span");
        name.textContent = link.name;
        value.className = "map-label-value";
        button.append(name, value);
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          latest.current.onSelect(id);
        });
        button.addEventListener("mouseenter", () => {
          hovered = id;
          update();
        });
        button.addEventListener("mouseleave", () => {
          hovered = null;
          update();
        });
        L.DomEvent.disableClickPropagation(button);
        const [lng, lat] = feature.properties.label;
        const marker = L.marker([lat, lng], {
          keyboard: false,
          interactive: true,
          icon: L.divIcon({
            className: "map-label-anchor",
            html: button,
            iconSize: [0, 0],
          }),
        }).addTo(map);
        labels.set(id, marker);
      }
      instance.current = { map, layers, labels, bounds, tiles, update, fit };
      fit();
      update();
      map.on("zoomend", update);
      setReady(true);
      let userMoved = false;
      map.on("dragstart zoomstart", () => {
        userMoved = true;
      });
      const resize = new ResizeObserver(() => {
        map.invalidateSize({ pan: false });
        if (!userMoved) fit();
      });
      resize.observe(element);
      cleanup = () => {
        resize.disconnect();
        tiles.off();
        map.off();
        map.remove();
        instance.current = null;
      };
    }
    void initialize().catch((e) => {
      cleanup?.();
      cleanup = undefined;
      if (!stopped && e.name !== "AbortError")
        setError(
          "Не удалось открыть локальные границы. Расчёт и агент доступны; обновите страницу.",
        );
    });
    return () => {
      stopped = true;
      abort.abort();
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    const request = focusRequest,
      state = instance.current;
    if (!ready || !request || !state || processed.current.has(request.id))
      return;
    processed.current.add(request.id);
    const layer = state.layers.get(request.featureId);
    if (!layer) {
      onFocusApplied?.(request.id, false);
      return;
    }
    state.map.stop();
    state.map.fitBounds(layer.getBounds(), {
      padding: [55, 60],
      maxZoom: 12.5,
      animate: false,
    });
    state.update();
    // fitBounds with animate:false is synchronous. Report execution only after
    // the selected label and an actual Leaflet camera change have been applied.
    const applied =
      state.map.getBounds().contains(layer.getBounds().getCenter()) &&
      selectedFeatureId === request.featureId;
    onFocusApplied?.(request.id, applied);
  }, [ready, focusRequest, selectedFeatureId, onFocusApplied]);

  function toggleBasemap() {
    const state = instance.current;
    if (!state) return;
    if (basemap) state.tiles.remove();
    else state.tiles.addTo(state.map);
    setBasemap(!basemap);
  }
  return (
    <div className="map-shell">
      <div
        ref={container}
        className="city-map"
        aria-label="Интерактивная карта районов Астаны"
      />
      <div className="map-actions">
        <button onClick={() => instance.current?.fit()} disabled={!ready}>
          <Maximize2 size={14} /> Весь город
        </button>
        <button
          onClick={toggleBasemap}
          disabled={!ready}
          aria-pressed={basemap}
        >
          <Layers2 size={14} /> Подложка
        </button>
      </div>
      {!ready && (
        <div className="map-loading" role="status">
          {error || "Открываем локальную карту Астаны…"}
        </div>
      )}
      {ready && (!basemap || tileError) && (
        <div className="map-base-status" role="status">
          {!basemap
            ? "Подложка отключена. Локальные границы доступны."
            : "Подложка не загрузилась полностью. Локальные границы и расчёты доступны."}
        </div>
      )}
      <div className="map-legend">
        <span>Индекс</span>
        <div className="map-scale-key">
          <i className="map-scale" />
          <div>
            <span>0</span>
            <span>50</span>
            <span>100</span>
          </div>
        </div>
        <span className="no-data-key">Нет данных</span>
        <span className="selected-key">Выбран</span>
      </div>
      <button
        className="map-source-button"
        onClick={() => setSources(!sources)}
        aria-expanded={sources}
      >
        <MapPin size={12} /> OSM · {sourceDate} · об источнике
      </button>
      {sources && (
        <div className="map-source-card">
          <strong>География и учебная модель</strong>
          <p>
            Шесть районов OSM, пять районов с учебными показателями. Связь по
            названию не означает реальную статистику территории.
          </p>
          <p>
            Снимок 23.09.2026. Соответствие официальным изменениям августа 2026
            не подтверждено. Южный участок города ≈11 км² не распределён между
            районными объектами OSM; показан пунктиром.
          </p>
          <a
            href="https://github.com/BAITC-Hacks/hack-8d88351c-eam-trinity/blob/codex/cityproof/data/geography/README.md"
            target="_blank"
            rel="noreferrer"
          >
            Источники, версии и ограничения ↗
          </a>
          <button onClick={() => setSources(false)}>Закрыть</button>
        </div>
      )}
      <div className="sr-only">
        {districts.map((d) => (
          <span key={d.mapFeatureId}>
            {d.name}
            {d.modelDistrictId ? "" : ": Не входит в учебный набор данных"}
            .{" "}
          </span>
        ))}
      </div>
    </div>
  );
}
