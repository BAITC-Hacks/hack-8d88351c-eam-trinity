"use client";
import { X } from "lucide-react";
import { model, format, formatExact, type Evidence } from "@/lib/model/engine";

export function EvidencePanel({
  evidence: e,
  experimental,
  onClose,
}: {
  evidence: Evidence;
  experimental: boolean;
  onClose: () => void;
}) {
  return (
    <section
      className="map-evidence"
      aria-label="Подтверждённое вычисление"
      data-evidence-id={e.id}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <button
        className="icon-button evidence-close"
        aria-label="Закрыть расчёт"
        onClick={onClose}
      >
        <X size={16} />
      </button>
      <span className="eyebrow">
        ОТКУДА ЧИСЛО · {experimental ? "УЧЕБНАЯ ЗИМА" : "ПОСЛЕ РЕШЕНИЙ"}
      </span>
      <div className="evidence-heading">
        <strong>
          {model.districts.find((d) => d.id === e.districtId)?.name} ·{" "}
          {e.metricId} · {model.metrics.find((m) => m.id === e.metricId)?.name}
        </strong>
        <b>
          {format(e.initial)} → {format(e.value)}
        </b>
      </div>
      <p>
        {e.contributions.length
          ? e.contributions
              .map(
                (c) =>
                  `${c.name}: ${c.delta > 0 ? "+" : ""}${formatExact(c.delta)} п.`,
              )
              .join("; ")
          : "Выбранные условия не меняют этот показатель."}
        {experimental ? " Допущение команды, не прогноз." : ""}
      </p>
      <details key={e.id}>
        <summary>Раскрыть арифметику</summary>
        <div className="ledger-row">
          <span>
            {experimental ? "После официального расчёта" : "Исходное значение"}
          </span>
          <b>{formatExact(e.initial)}</b>
        </div>
        {e.contributions.map((c, i) => (
          <div className="ledger-row" key={i}>
            <span>
              {c.measureId} · {c.name}
              <small>
                {c.kind === "measure"
                  ? `${formatExact(c.full)} × ${formatExact(c.factor)} (с учётом лага)`
                  : c.kind === "synergy"
                    ? "Фиксированный бонус без лага"
                    : "Учебное допущение команды"}
              </small>
            </span>
            <b>
              {c.delta > 0 ? "+" : ""}
              {formatExact(c.delta)}
            </b>
          </div>
        ))}
        <div className="ledger-row">
          <span>Сумма до ограничения</span>
          <b>{formatExact(e.beforeClip)}</b>
        </div>
        <div className="ledger-row">
          <span>После ограничения [0, 100]</span>
          <b>{formatExact(e.value)}</b>
        </div>
        <small>
          Источник:{" "}
          {experimental
            ? "stress_events.json · winter_demo 1.0"
            : "Датасет организаторов · разделы 2–3"}
          . Текущий снимок решений.
        </small>
      </details>
    </section>
  );
}
