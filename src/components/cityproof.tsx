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
import { CityScene } from "./city-scene";
import {
  model,
  computeBaseline,
  evaluateScenario,
  runStress,
  validate,
  format,
  formatExact,
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
    [district, setDistrict] = useState<DistrictId>("nura"),
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
    [tab, setTab] = useState<"catalog" | "agent">("catalog");
  const controller = useRef<AbortController | null>(null),
    agentScroll = useRef<HTMLDivElement | null>(null),
    dialogRef = useRef<HTMLElement | null>(null),
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
  const selectedDistrict = model.districts.find((d) => d.id === district)!;
  const selectedMetric = model.metrics.find((m) => m.id === metric)!;
  useEffect(() => {
    fetch("/api/analyze")
      .then((r) => r.json())
      .then((r) => setApiReady(r.configured))
      .catch(() => setApiReady(false));
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    if (!evidence) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEvidence(null);
      if (event.key === "Tab") {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button,a[href],input,select,textarea,[tabindex="0"]',
        );
        if (!controls?.length) return;
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [evidence]);
  function changePlan(next: Decision[]) {
    currentKey.current = snapshotKey(next, winter);
    controller.current?.abort();
    setBusy(false);
    setDecisions(next);
    setMode(
      evaluateScenario({ decisions: next }).valid ? "official" : "baseline",
    );
    setEvidence(null);
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
    changePlan([
      ...decisions,
      {
        measure_id: id,
        ...(m.scope === "district" ? { district_id: district } : {}),
      },
    ]);
  }
  function showEvidence(e: Evidence) {
    setEvidence(e);
    setDistrict(e.districtId);
    setMetric(e.metricId);
    setMode(e.id.includes("winter_demo") ? "experimental" : "official");
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
          focus: { district_id: district, metric_id: metric },
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
          if (currentKey.current !== requestKey || controller.current !== abort)
            continue;
          if (event.type === "error") throw new Error(event.text);
          if (event.type === "answer") gotAnswer = true;
          if (event.runId) runRef.current = event.runId;
          setMessages((prev) => [...prev, event]);
          if (event.type === "result" && event.result) {
            const serverResult = event.result;
            setAuditResults((prev) => ({
              ...prev,
              [serverResult.kind]: serverResult,
            }));
            setMode(
              event.result.kind === "experimental"
                ? "experimental"
                : "official",
            );
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
        <div
          className="header-budget"
          aria-label={`Бюджет ${cost} из 100. Выбрано ${decisions.length} из 5 решений`}
        >
          <span>
            <b className={cost > 100 ? "warning" : ""}>{cost}</b> / 100{" "}
            <small>бюджет</small>
          </span>
          <span>
            <b>{decisions.length}</b> / 5 <small>решений</small>
          </span>
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
              value={district}
              onChange={(e) => setDistrict(e.target.value as DistrictId)}
            >
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
                      disabled={!selected && decisions.length >= 5}
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
          <div className="city-heading">
            <div>
              <div className="eyebrow">
                <span className="live-dot" /> ГОРОД БУДУЩЕГО · РЕШЕНИЯ СЕГОДНЯ
              </div>
              <h1>
                Астана. <br />
                <em>Сценарии будущего.</em>
              </h1>
              <p>Измените условия. Проверьте результат.</p>
            </div>
            <div className="scene-index">
              05<span>районов</span>
            </div>
          </div>
          <div className="scene-controls">
            <div className="segmented" aria-label="Режим сцены">
              <button
                className={mode === "baseline" ? "active" : ""}
                onClick={() => setMode("baseline")}
              >
                Исходное
              </button>
              <button
                disabled={!official}
                className={mode === "official" ? "active" : ""}
                onClick={() => setMode("official")}
              >
                После решений
              </button>
              <button
                disabled={!stress}
                className={mode === "experimental" ? "active" : ""}
                onClick={() => setMode("experimental")}
              >
                <Snowflake size={12} />
                Учебная зима
              </button>
            </div>
            <select
              aria-label="Показатель на сцене"
              value={metric}
              onChange={(e) => setMetric(e.target.value as MetricId)}
            >
              {model.metrics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} · {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="scene-wrap">
            <CityScene
              result={result}
              selected={district}
              metric={metric}
              decisions={decisions}
              onSelect={setDistrict}
            />
            <div className="scene-note">
              <Layers3 size={13} /> Условная схема пяти районов
            </div>
            <div className="scene-legend">
              <span>
                <i />
                40–100
              </span>
              <span>
                <i className="amber" />
                ниже 40
              </span>
              <small>{selectedMetric.id} · пункты индекса</small>
            </div>
            {decisions.some((d) => !d.district_id) && (
              <div className="city-measures">
                <Globe2 size={12} /> Городские меры:{" "}
                {decisions
                  .filter((d) => !d.district_id)
                  .map((d) => d.measure_id)
                  .join(" · ")}
              </div>
            )}
          </div>
          <div className="district-strip">
            <div className="district-title">
              <span className="eyebrow">В ФОКУСЕ</span>
              <strong>{selectedDistrict.name}</strong>
              <span>
                {mode === "experimental"
                  ? "Учебное событие"
                  : mode === "official"
                    ? "После решений"
                    : "Исходные данные"}
              </span>
            </div>
            <div className="metric-grid">
              {model.metrics.map((m) => (
                <button
                  key={m.id}
                  className={`${metric === m.id ? "active" : ""} ${result.indicators[district][m.id] < 40 ? "critical" : ""}`}
                  title={m.name}
                  onClick={() => {
                    setMetric(m.id);
                    if (result.kind !== "baseline")
                      showEvidence(
                        result.evidence[`${result.id}:${district}:${m.id}`],
                      );
                  }}
                >
                  <span>{m.id}</span>
                  <strong>{format(result.indicators[district][m.id])}</strong>
                </button>
              ))}
            </div>
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
              <strong>{official ? result.criticalPairs.length : "—"}</strong>
            </div>
          </div>
          <div className="context-note">
            <Info size={13} />
            {official
              ? mode === "experimental"
                ? `Допущения команды. Официальный Score: ${format(official.score)}. Эксперимент его не заменяет.`
                : mode === "baseline"
                  ? "Исходное состояние для сравнения. Это не пользовательский план."
                  : "Официальный расчёт по данным задания. Горизонт: 8 кварталов."
              : "Выберите пять допустимых мер, чтобы получить результат. Сцена пока показывает исходные данные."}
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
                          ? "Готово"
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
                      if (e) showEvidence(e);
                    }}
                  >
                    <span>
                      {f.label}
                      <strong>{f.value}</strong>
                    </span>
                    {f.evidenceId && <ChevronRight size={15} />}
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
              onClick={() =>
                setQuestion(
                  `Объясни показатель ${metric} в районе ${selectedDistrict.name} и покажи расчёт.`,
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
                busy ? controller.current?.abort() : void analyze()
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
      {evidence && (
        <div className="drawer-backdrop" onClick={() => setEvidence(null)}>
          <section
            className="evidence-drawer"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Происхождение числа"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-button close"
              aria-label="Закрыть расчёт"
              onClick={() => setEvidence(null)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">ОТКУДА ЧИСЛО</span>
            <h2>
              {selectedDistrict.name} / {evidence.metricId}
            </h2>
            <p>{model.metrics.find((m) => m.id === evidence.metricId)?.name}</p>
            <div className="evidence-total">
              {format(evidence.value)}
              <span>пунктов индекса</span>
            </div>
            <div className="ledger-row">
              <span>
                {evidence.id.includes("winter_demo")
                  ? "После официального расчёта"
                  : "Исходное значение"}
              </span>
              <b>{formatExact(evidence.initial)}</b>
            </div>
            {evidence.contributions.map((c, i) => (
              <div className="ledger-row" key={i}>
                <span>
                  {c.measureId} · {c.name}
                  <small>
                    {c.kind === "measure"
                      ? `${formatExact(c.full)} × ${formatExact(c.factor)} (доля эффекта с учётом лага)`
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
            {evidence.contributions.length === 0 && (
              <p>Выбранные меры не меняют этот показатель.</p>
            )}
            <div className="ledger-row">
              <span>Сумма до ограничения</span>
              <b>{formatExact(evidence.beforeClip)}</b>
            </div>
            <div className="ledger-row">
              <span>После ограничения [0, 100]</span>
              <b>{formatExact(evidence.value)}</b>
            </div>
            <p className="evidence-source">
              Источник:{" "}
              {evidence.id.includes("winter_demo")
                ? "stress_events.json · winter_demo 1.0"
                : "Датасет организаторов · разделы 2–3"}
              . Результат относится только к выбранным условиям.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
