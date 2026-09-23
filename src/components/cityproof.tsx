"use client";
import { useMemo, useState, useRef, useEffect } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowUp,
  ArrowRight,
  Layers3,
  Sparkles,
  Plus,
  Check,
  RotateCcw,
  X,
  MapPin,
  Globe2,
  Clock3,
  Snowflake,
  ChevronRight,
  Square,
  Activity,
  Info,
} from "lucide-react";
import { CityMap } from "./city-map";
import { EvidencePanel } from "./evidence-panel";
import {
  commandForEvidence,
  resolveMapCommand,
  type MapCommand,
} from "@/lib/map/commands";
import {
  districtForFeature,
  featureForDistrict,
  type MapFocusRequest,
} from "@/lib/map/geography";
import {
  model,
  computeBaseline,
  evaluateScenario,
  runStress,
  validate,
  format,
  snapshotKey,
  type Decision,
  type DistrictId,
  type MetricId,
  type Result,
  type Evidence,
} from "@/lib/model/engine";
type AuditMessage = {
  type: string;
  name?: string;
  status?: string;
  durationMs?: number;
  text?: string;
  result?: Result;
  answer?: {
    summary: string;
    facts: {
      label: string;
      value: string;
      evidenceId?: string;
      resultId?: string;
    }[];
    limitations: string[];
  };
  evidence?: Evidence;
  runId?: string;
  command?: MapCommand;
  commandId?: string;
};
const directions = [
  "Все",
  "Транспорт",
  "Экология",
  "Соцсфера",
  "Безопасность",
  "Сервисы",
];
const baseline = computeBaseline();
export function Cityproof() {
  const [decisions, setDecisions] = useState<Decision[]>([]),
    [district, setDistrict] = useState<DistrictId | null>("nura"),
    [metric, setMetric] = useState<MetricId>("C1"),
    [filter, setFilter] = useState("Все"),
    [mode, setMode] = useState<"baseline" | "official" | "experimental">(
      "baseline",
    ),
    [winter, setWinter] = useState(true),
    [question, setQuestion] = useState(""),
    [busy, setBusy] = useState(false),
    [messages, setMessages] = useState<AuditMessage[]>([]),
    [auditResults, setAuditResults] = useState<
      Partial<Record<"official" | "experimental", Result>>
    >({}),
    [error, setError] = useState(""),
    [evidence, setEvidence] = useState<Evidence | null>(null),
    [apiReady, setApiReady] = useState<boolean | null>(null),
    [tab, setTab] = useState<"catalog" | "agent">("catalog"),
    [mapFocus, setMapFocus] = useState<MapFocusRequest | null>(null);
  const controller = useRef<AbortController | null>(null),
    agentScroll = useRef<HTMLDivElement | null>(null),
    pendingMap = useRef<{
      command: MapCommand;
      abort?: AbortController;
    } | null>(null),
    mapAllowed = useRef(true),
    seenCommands = useRef(new Set<string>()),
    runRef = useRef<string | undefined>(undefined),
    currentKey = useRef("");
  const key = snapshotKey(decisions, winter);
  useEffect(() => {
    currentKey.current = key;
  }, [key]);
  useEffect(() => {
    const node = agentScroll.current;
    if (node) node.scrollTop = messages.length || error ? node.scrollHeight : 0;
  }, [messages, error]);
  const evaluation = useMemo(
    () => evaluateScenario({ decisions }),
    [decisions],
  );
  const experimental = useMemo(
    () => runStress({ decisions }, "winter_demo"),
    [decisions],
  );
  const official = evaluation.valid
    ? (auditResults.official ?? evaluation.result)
    : null;
  const stress = experimental.valid
    ? (auditResults.experimental ?? experimental.result)
    : null;
  const result =
    mode === "experimental" && stress
      ? stress
      : mode === "official" && official
        ? official
        : baseline;
  const cost = decisions.reduce(
    (sum, d) => sum + model.measures.find((m) => m.id === d.measure_id)!.cost,
    0,
  );
  const issues = validate({ decisions });
  const selectedDistrict = featureForDistrict(district);
  useEffect(() => {
    fetch("/api/analyze")
      .then((r) => r.json())
      .then((r) => setApiReady(r.configured))
      .catch(() => setApiReady(false));
    return () => controller.current?.abort();
  }, []);
  function clearMapRequest(manual = false) {
    if (manual) mapAllowed.current = false;
    const pending = pendingMap.current;
    if (pending?.abort)
      setMessages((prev) =>
        prev.map((m) =>
          m.type === "map_status" &&
          m.commandId === pending.command.id &&
          m.status === "requested"
            ? {
                ...m,
                status: "cancelled",
                text: "Ожидавшийся переход отменён. Текущее управление картой сохранено.",
              }
            : m,
        ),
      );
    pendingMap.current = null;
    setMapFocus(null);
  }
  function selectMapState(update: () => void) {
    clearMapRequest(true);
    setEvidence(null);
    update();
  }
  function mayApplyMap(id: string) {
    const pending = pendingMap.current;
    return (
      !!pending &&
      pending.command.id === id &&
      pending.command.snapshotKey === currentKey.current &&
      (!pending.abort ||
        (!pending.abort.signal.aborted &&
          controller.current === pending.abort &&
          mapAllowed.current))
    );
  }
  function mapApplied(id: string, applied: boolean) {
    if (!mayApplyMap(id)) return;
    const pending = pendingMap.current!;
    if (pending.abort)
      setMessages((prev) => [
        ...prev,
        {
          type: "map_status",
          commandId: id,
          status: applied ? "applied" : "failed",
          text: applied
            ? "Показано на карте: район, показатель, режим и вычисление подтверждены браузером."
            : "Карта не подтвердила переход. Вычисление доступно в ответе.",
        },
      ]);
    pendingMap.current = null;
    setMapFocus(null);
  }
  function changePlan(next: Decision[]) {
    currentKey.current = snapshotKey(next, winter);
    controller.current?.abort();
    setBusy(false);
    setDecisions(next);
    setMode(
      evaluateScenario({ decisions: next }).valid ? "official" : "baseline",
    );
    setEvidence(null);
    clearMapRequest();
    setMessages([]);
    setAuditResults({});
    setError("");
    runRef.current = undefined;
  }
  function toggle(id: string) {
    const m = model.measures.find((m) => m.id === id)!;
    if (decisions.some((d) => d.measure_id === id)) {
      changePlan(decisions.filter((d) => d.measure_id !== id));
      return;
    }
    if (m.scope === "district" && !district) return;
    changePlan([
      ...decisions,
      {
        measure_id: id,
        ...(m.scope === "district" && district
          ? { district_id: district }
          : {}),
      },
    ]);
  }
  function showEvidence(
    e: Evidence,
    focusMap = false,
    command?: MapCommand,
    abort?: AbortController,
  ) {
    const parent = [official, stress].find((r) => r?.evidence[e.id]);
    if (!parent || (parent.kind === "experimental" && !winter)) return;
    const canonical = parent.evidence[e.id];
    if (!command) clearMapRequest(true);
    setEvidence(canonical);
    setDistrict(canonical.districtId);
    setMetric(canonical.metricId);
    setMode(parent.kind === "experimental" ? "experimental" : "official");
    if (focusMap) {
      const target =
        command ??
        commandForEvidence(crypto.randomUUID(), parent, canonical, winter);
      pendingMap.current = { command: target, abort };
      setMapFocus(target);
    }
  }
  async function analyze(prompt?: string) {
    if (!official) {
      setError("Сначала соберите допустимый план из пяти мероприятий.");
      return;
    }
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const requestKey = key;
    clearMapRequest();
    mapAllowed.current = true;
    seenCommands.current.clear();
    setEvidence(null);
    setBusy(true);
    setError("");
    setMessages([]);
    setTab("agent");
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decisions,
          question:
            prompt ||
            question ||
            `Проверь мой план в обычных условиях${winter ? " и при учебной зиме" : ""}. Объясни основные изменения.`,
          winter,
          ...(district
            ? { focus: { district_id: district, metric_id: metric } }
            : {}),
          runId: runRef.current,
        }),
        signal: abort.signal,
      });
      if (!response.ok) {
        const data = await response.json();
        if (response.status === 409) runRef.current = undefined;
        throw new Error(data.error || "Не удалось выполнить анализ.");
      }
      if (!response.body) throw new Error("Поток ответа недоступен.");
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      let gotAnswer = false;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as AuditMessage;
          if (
            abort.signal.aborted ||
            currentKey.current !== requestKey ||
            controller.current !== abort
          )
            continue;
          if (event.type === "error") throw new Error(event.text);
          if (event.type === "answer") gotAnswer = true;
          if (event.runId) runRef.current = event.runId;
          if (event.type === "map_command") {
            const resolved = resolveMapCommand(
              event.command,
              requestKey,
              [
                evaluation.valid ? evaluation.result : null,
                winter && experimental.valid ? experimental.result : null,
              ].filter((r): r is Result => !!r),
            );
            if (!resolved || seenCommands.current.has(resolved.command.id))
              continue;
            seenCommands.current.add(resolved.command.id);
            if (!mapAllowed.current) {
              setMessages((prev) => [
                ...prev,
                {
                  type: "map_status",
                  commandId: resolved.command.id,
                  status: "cancelled",
                  text: "Команда получена, но переход отменён: вы изменили карту вручную.",
                },
              ]);
              continue;
            }
            setMessages((prev) => [
              ...prev,
              {
                type: "map_status",
                commandId: resolved.command.id,
                status: "requested",
                text: "Агент запросил показ на карте.",
              },
            ]);
            showEvidence(resolved.evidence, true, resolved.command, abort);
            continue;
          }
          setMessages((prev) => [...prev, event]);
          if (event.type === "result" && event.result) {
            const serverResult = event.result;
            setAuditResults((prev) => ({
              ...prev,
              [serverResult.kind]: serverResult,
            }));
          }
        }
      }
      if (
        !gotAnswer &&
        currentKey.current === requestKey &&
        controller.current === abort
      )
        throw new Error(
          "Соединение завершилось без подтверждённого ответа. Запустите проверку повторно.",
        );
      if (currentKey.current === requestKey && controller.current === abort)
        setQuestion("");
    } catch (e) {
      if (currentKey.current === requestKey && controller.current === abort)
        setError(
          e instanceof Error && e.name === "AbortError"
            ? "Анализ остановлен. Уже выполненные расчёты сохранены."
            : e instanceof Error
              ? e.message
              : "Ошибка соединения.",
        );
    } finally {
      if (currentKey.current === requestKey && controller.current === abort)
        setBusy(false);
    }
  }
  const answer = messages.findLast((m) => m.type === "answer")?.answer;
  const allEvidence = [
    ...(official ? Object.values(official.evidence) : []),
    ...(stress ? Object.values(stress.evidence) : []),
  ];
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="CITYPROOF — главная">
          <span className="brand-mark">
            <Layers3 size={21} />
          </span>
          CITY<span>PROOF</span>
          <sup>LAB</sup>
        </Link>
        <div className="top-caption">
          АСТАНА<span>/</span>Лаборатория городских сценариев
        </div>
        <div className="study-badge">
          <span /> Учебная модель
        </div>
        <button
          className="icon-button"
          title="Сбросить план"
          aria-label="Сбросить план"
          onClick={() => changePlan([])}
        >
          <RotateCcw size={16} />
        </button>
      </header>
      <nav className="mobile-tabs">
        <button
          onClick={() => setTab("catalog")}
          className={tab === "catalog" ? "active" : ""}
        >
          Мероприятия
        </button>
        <button
          onClick={() => setTab("agent")}
          className={tab === "agent" ? "active" : ""}
        >
          AI-агент
        </button>
      </nav>
      <main className="workspace">
        <aside
          className={`catalog panel ${tab === "catalog" ? "mobile-active" : ""}`}
        >
          <div className="panel-heading">
            <span className="eyebrow">01 / ВАШ СЦЕНАРИЙ</span>
            <h2>
              Городские решения <span>14</span>
            </h2>
            <p>Пять решений. Один общий бюджет.</p>
          </div>
          <div className="budget">
            <div>
              <span>Использовано</span>
              <strong className={cost > 100 ? "warning" : ""}>
                {cost}
                <small> / 100</small>
              </strong>
            </div>
            <div className="budget-track">
              <i style={{ width: `${Math.min(cost, 100)}%` }} />
            </div>
            <div className="budget-bottom">
              <span>Условные единицы</span>
              <span>{decisions.length} / 5 решений</span>
            </div>
          </div>
          <div className="district-target">
            <MapPin size={14} />
            <label htmlFor="target">Район для новой меры</label>
            <select
              id="target"
              value={district ?? ""}
              onChange={(e) =>
                selectMapState(() => setDistrict(e.target.value as DistrictId))
              }
            >
              {!district && (
                <option value="" disabled>
                  Выберите район с учебными данными
                </option>
              )}
              {model.districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          {decisions.length > 0 && (
            <div className="selection-chips" aria-label="Выбранные мероприятия">
              {decisions.map((d) => (
                <button
                  key={d.measure_id}
                  title={
                    model.measures.find((m) => m.id === d.measure_id)?.name
                  }
                  aria-label={`Убрать ${d.measure_id} из плана`}
                  onClick={() => toggle(d.measure_id)}
                >
                  {d.measure_id}
                  <X size={10} />
                </button>
              ))}
            </div>
          )}
          <div className="filters" aria-label="Направления">
            {directions.map((d) => (
              <button
                key={d}
                className={filter === d ? "active" : ""}
                onClick={() => setFilter(d)}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="measure-list">
            {model.measures
              .filter((m) => filter === "Все" || m.direction === filter)
              .map((m) => {
                const selected = decisions.find((d) => d.measure_id === m.id);
                return (
                  <article
                    key={m.id}
                    className={`measure ${selected ? "chosen" : ""}`}
                  >
                    <div className="measure-top">
                      <span>
                        {m.id} <b>·</b> {m.direction}
                      </span>
                      <strong>
                        {m.cost}
                        <small> ед.</small>
                      </strong>
                    </div>
                    <button
                      className="measure-select"
                      onClick={() => toggle(m.id)}
                      disabled={
                        !selected &&
                        (decisions.length >= 5 ||
                          (m.scope === "district" && !district))
                      }
                      aria-label={`${selected ? "Удалить" : "Добавить"} ${m.id}: ${m.name}`}
                    >
                      <span>{m.name}</span>
                      <i>
                        {selected ? <Check size={15} /> : <Plus size={15} />}
                      </i>
                    </button>
                    <div className="measure-meta">
                      <span>
                        {m.scope === "city" ? (
                          <Globe2 size={11} />
                        ) : (
                          <MapPin size={11} />
                        )}{" "}
                        {selected?.district_id
                          ? model.districts.find(
                              (d) => d.id === selected.district_id,
                            )?.name
                          : m.scope === "city"
                            ? "Весь город"
                            : "Один район"}
                      </span>
                      <span>
                        <Clock3 size={11} />
                        {m.lag_quarters} кв.
                      </span>
                    </div>
                    {selected && m.scope === "district" && (
                      <select
                        aria-label={`Район ${m.id}`}
                        value={selected.district_id}
                        onChange={(e) =>
                          changePlan(
                            decisions.map((d) =>
                              d.measure_id === m.id
                                ? {
                                    ...d,
                                    district_id: e.target.value as DistrictId,
                                  }
                                : d,
                            ),
                          )
                        }
                      >
                        {model.districts.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </article>
                );
              })}
          </div>
          <div className="catalog-footer">
            <button
              className="text-button"
              onClick={() => changePlan(model.source_example.decisions)}
            >
              Пример из задания <ArrowUpRight size={15} />
            </button>
            <span>Стартовый набор, не рекомендация</span>
          </div>
        </aside>
        <section className="city-workspace">
          <div className="map-heading">
            <h1>Астана</h1>
            <span>Карта районов · учебные сценарии</span>
          </div>
          <div className="scene-controls">
            <div className="segmented" aria-label="Режим карты">
              <button
                className={mode === "baseline" ? "active" : ""}
                onClick={() => selectMapState(() => setMode("baseline"))}
              >
                Исходное
              </button>
              <button
                disabled={!official}
                className={mode === "official" ? "active" : ""}
                onClick={() => selectMapState(() => setMode("official"))}
              >
                После решений
              </button>
              <button
                disabled={!stress || !winter}
                className={mode === "experimental" ? "active" : ""}
                onClick={() => selectMapState(() => setMode("experimental"))}
              >
                <Snowflake size={12} />
                Учебная зима
              </button>
            </div>
            <select
              aria-label="Показатель на карте"
              value={metric}
              onChange={(e) =>
                selectMapState(() => setMetric(e.target.value as MetricId))
              }
            >
              {model.metrics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} · {m.name}
                </option>
              ))}
            </select>
          </div>
          <CityMap
            result={result}
            metric={metric}
            selectedFeatureId={selectedDistrict.mapFeatureId}
            onSelect={(id) => {
              const d = districtForFeature(id);
              if (d) {
                selectMapState(() => setDistrict(d.modelDistrictId));
              }
            }}
            focusRequest={mapFocus}
            evidenceId={evidence?.id}
            onBeforeFocus={mayApplyMap}
            onFocusApplied={mapApplied}
            onManualInteraction={() => clearMapRequest(true)}
          />
          {!evidence && (
            <>
              <div className="district-strip">
                <div className="district-title">
                  <span className="eyebrow">В ФОКУСЕ</span>
                  <strong>{selectedDistrict.name}</strong>
                  <span>
                    {!district
                      ? "География OSM"
                      : mode === "experimental"
                        ? "Учебное событие"
                        : mode === "official"
                          ? "После решений"
                          : "Исходные данные"}
                  </span>
                </div>
                {district ? (
                  <div className="metric-grid">
                    {model.metrics.map((m) => (
                      <button
                        key={m.id}
                        className={`${metric === m.id ? "active" : ""} ${result.indicators[district][m.id] < 40 ? "critical" : ""}`}
                        title={m.name}
                        onClick={() => {
                          selectMapState(() => setMetric(m.id));
                          if (result.kind !== "baseline")
                            showEvidence(
                              result.evidence[
                                `${result.id}:${district}:${m.id}`
                              ],
                            );
                        }}
                      >
                        <span>{m.id}</span>
                        <strong>
                          {format(result.indicators[district][m.id])}
                        </strong>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="district-no-data">
                    <strong>Не входит в учебный набор данных</strong>
                    <span>
                      Показатели отсутствуют. Мероприятия этому району не
                      назначаются.
                    </span>
                  </div>
                )}
              </div>
              <div className="result-strip">
                <div>
                  <span>
                    {mode === "experimental"
                      ? "Учебный результат"
                      : mode === "baseline"
                        ? "Исходный ориентир"
                        : "Результат по заданию"}
                  </span>
                  <strong>
                    {official ? format(result.score) : "—"}
                    <small>Score</small>
                  </strong>
                </div>
                <div>
                  <span>Среднее города</span>
                  <strong>{official ? format(result.cityMean) : "—"}</strong>
                </div>
                <div>
                  <span>Минимум по районам</span>
                  <strong>{official ? format(result.minimum) : "—"}</strong>
                </div>
                <div>
                  <span>Значений ниже 40</span>
                  <strong>
                    {official ? result.criticalPairs.length : "—"}
                  </strong>
                </div>
              </div>
            </>
          )}
          {evidence && (
            <EvidencePanel
              evidence={evidence}
              experimental={mode === "experimental"}
              onClose={() => {
                clearMapRequest(true);
                setEvidence(null);
              }}
            />
          )}
          <p className="geography-note">
            Учебные показатели одноимённых районов, не статистика реальных
            территорий.
          </p>
          <div className="context-note">
            <Info size={13} />
            {official
              ? mode === "experimental"
                ? `Допущения команды. Официальный Score: ${format(official.score)}. Эксперимент его не заменяет.`
                : mode === "baseline"
                  ? "Исходное состояние для сравнения. Это не пользовательский план."
                  : "Официальный расчёт по данным задания. Горизонт: 8 кварталов."
              : "Выберите пять допустимых мер, чтобы получить результат. Карта пока показывает исходные учебные данные."}
          </div>
        </section>
        <aside
          className={`agent panel ${tab === "agent" ? "mobile-active" : ""}`}
        >
          <div className="panel-heading">
            <span className="eyebrow">02 / ПРОВЕРКА ГИПОТЕЗЫ</span>
            <div className="agent-heading">
              <h2>
                <Sparkles size={19} /> AI-аналитик
              </h2>
              <span
                className={`api-dot ${apiReady ? "ready" : ""}`}
                title={
                  apiReady
                    ? "API настроен; доступность проверяется вызовом"
                    : "API не настроен"
                }
              />
            </div>
            <p>От вопроса — к проверяемым фактам.</p>
          </div>
          <div className="agent-scroll" ref={agentScroll}>
            {!busy && !error && messages.length === 0 && (
              <div className="agent-intro">
                <div className="agent-orb">
                  <Activity size={27} />
                </div>
                <h3>
                  Что изменится
                  <br />в вашем городе?
                </h3>
                <p>
                  Агент проверит выбранный план, вызовет расчётные инструменты и
                  покажет, откуда взялись выводы.
                </p>
                <div className="tool-pills">
                  <span>Расчёт</span>
                  <ArrowRight size={11} />
                  <span>Проверка</span>
                  <ArrowRight size={11} />
                  <span>Факты</span>
                </div>
              </div>
            )}
            <label className="winter-toggle">
              <div>
                <Snowflake size={17} />
                <strong>Учебная зима</strong>
              </div>
              <input
                type="checkbox"
                checked={winter}
                onChange={(e) => {
                  currentKey.current = snapshotKey(decisions, e.target.checked);
                  controller.current?.abort();
                  setBusy(false);
                  clearMapRequest();
                  setEvidence(null);
                  setMode(official ? "official" : "baseline");
                  setWinter(e.target.checked);
                  setMessages([]);
                  setAuditResults({});
                  setError("");
                  runRef.current = undefined;
                }}
              />
              <span>Допущения команды, не прогноз</span>
            </label>
            <div className="shock-values">
              <span>
                Разгрузка дорог <b>−4 п.</b>
              </span>
              <span>
                Надёжность ЖКХ <b>−8 п.</b>
              </span>
              <small>Во всех районах, после основного расчёта.</small>
            </div>
            {issues.length > 0 && decisions.length > 0 && (
              <div className="issues" role="status">
                {issues.map((e, i) => (
                  <p key={i}>{e.message}</p>
                ))}
              </div>
            )}
            {apiReady === false && (
              <div className="api-warning">
                <span>AI-анализ пока недоступен</span>На сервере нужны
                OPENAI_API_KEY и OPENAI_MODEL. Расчёт и учебная зима доступны
                без API.
              </div>
            )}
            {messages.filter((m) => m.type === "tool").length > 0 && (
              <div className="tool-log">
                <span className="eyebrow">ЖУРНАЛ ИНСТРУМЕНТОВ</span>
                {messages
                  .filter((m) => m.type === "tool")
                  .map((m, i) => (
                    <div key={i}>
                      <i className={m.status === "completed" ? "done" : ""} />
                      <code>{m.name}</code>
                      <span>
                        {m.status === "completed"
                          ? m.name === "show_evidence_on_map"
                            ? "Отправлено"
                            : "Готово"
                          : m.status === "failed"
                            ? "Ошибка"
                            : "Начат"}
                        {m.durationMs !== undefined
                          ? ` · ${m.durationMs} мс`
                          : ""}
                      </span>
                    </div>
                  ))}
              </div>
            )}
            {messages
              .filter((m) => m.type === "map_status")
              .map((m, i) => (
                <p
                  className={`map-action-status ${m.status}`}
                  role="status"
                  key={i}
                >
                  {m.text}
                </p>
              ))}
            {answer && (
              <div className="answer">
                <h3>Ответ по данным модели</h3>
                <p>{answer.summary}</p>
                {answer.facts.map((f, i) => (
                  <button
                    key={i}
                    disabled={!f.evidenceId}
                    onClick={() => {
                      const e = allEvidence.find((e) => e.id === f.evidenceId);
                      if (e) showEvidence(e, true);
                    }}
                  >
                    <span>
                      {f.label}
                      <strong>{f.value}</strong>
                    </span>
                    {f.evidenceId && (
                      <span className="show-map-action">
                        Показать на карте <ChevronRight size={13} />
                      </span>
                    )}
                  </button>
                ))}
                {answer.limitations.map((l, i) => (
                  <small key={i}>{l}</small>
                ))}
              </div>
            )}
            {error && (
              <div className="error-box" role="alert">
                {error}
              </div>
            )}
          </div>
          <div className="agent-compose">
            <button
              className="quick-question"
              disabled={!district}
              onClick={() =>
                setQuestion(
                  `Объясни показатель ${metric} в районе ${selectedDistrict.name} и объясни расчёт.`,
                )
              }
            >
              Объясни выбранный показатель <ArrowUpRight size={12} />
            </button>
            <label className="sr-only" htmlFor="question">
              Вопрос агенту
            </label>
            <textarea
              id="question"
              maxLength={1200}
              placeholder="Задайте свой вопрос о плане…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <button
              className="primary-button"
              disabled={!official}
              onClick={() =>
                busy
                  ? (controller.current?.abort(),
                    clearMapRequest(),
                    setBusy(false))
                  : void analyze()
              }
            >
              {busy ? (
                <>
                  <Square size={13} />
                  Остановить анализ
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Проверить план
                  <ArrowUp size={17} />
                </>
              )}
            </button>
            <small>Числа считает модель города. ИИ объясняет.</small>
          </div>
        </aside>
      </main>
      <footer className="app-footer">
        <span>
          CITYPROOF <b>·</b> HACKALEM AI
        </span>
        <span>
          Синтетические данные <b>·</b> Решения остаются за вами
        </span>
        <span>Модель {model.schema_version}</span>
      </footer>
    </div>
  );
}
