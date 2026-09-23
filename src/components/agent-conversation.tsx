"use client";
import { Check, ArrowRight, Sparkles, MapPin, BookOpen } from "lucide-react";
import { executionSteps, type ChatTurn } from "@/lib/ai/chat";
import type { Fact } from "@/lib/ai/explanation";

export function AgentConversation({
  turns,
  currentKey,
  onEvidence,
}: {
  turns: ChatTurn[];
  currentKey: string;
  onEvidence: (id: string, open: boolean) => void;
}) {
  return (
    <div className="conversation" aria-label="Диалог с CITYPROOF AI">
      {turns.map((turn) => {
        const steps = executionSteps(turn.events);
        const live = turn.status === "running";
        const moving =
          steps.some((s) => s.state === "moving") &&
          !turn.restored &&
          turn.key === currentKey;
        const current = !turn.restored && turn.key === currentKey;
        const answer = turn.answer;
        const primary =
          answer?.facts.find((f) => f.evidenceId) ?? answer?.facts[0];
        const otherFacts = answer?.facts.filter((f) => f !== primary) ?? [];
        const renderFact = (fact: Fact, key: string) => (
          <div className="chat-fact" key={key}>
            <span>{fact.label}</span>
            <strong>{fact.value}</strong>
            {fact.evidenceId && (
              <div className="fact-actions">
                <button
                  disabled={!current}
                  onClick={() => onEvidence(fact.evidenceId!, true)}
                >
                  <BookOpen size={13} />
                  Посмотреть расчёт
                </button>
                <button
                  disabled={!current}
                  aria-label={`Показать на карте: ${fact.label}`}
                  title="Показать на карте"
                  onClick={() => onEvidence(fact.evidenceId!, true)}
                >
                  <MapPin size={14} />
                </button>
              </div>
            )}
          </div>
        );
        return (
          <article className="chat-turn" data-turn-id={turn.id} key={turn.id}>
            <div className="message message-user">
              <span className="message-author">Вы</span>
              <p>{turn.question}</p>
            </div>
            <div className="message message-ai">
              <span className="message-author">
                <Sparkles size={14} /> CITYPROOF AI
              </span>
              {!current && (
                <p className="transcript-note">
                  {turn.restored
                    ? "Сохранённый диалог вкладки"
                    : "Ответ для предыдущего снимка решений"}
                  . Для актуального расчёта отправьте новый вопрос.
                </p>
              )}
              {live && (
                <div className="thinking-status" role="status">
                  Анализирую ваш сценарий
                  <span className="thinking-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="sr-only">…</span>
                </div>
              )}
              {steps.length > 0 &&
                (live || moving ? (
                  <ul
                    className="execution-steps"
                    aria-label="Выполненные операции"
                  >
                    {steps.map((s, i) => (
                      <li className={s.state} key={i}>
                        {s.state === "done" ? (
                          <Check size={14} />
                        ) : (
                          <ArrowRight size={14} />
                        )}
                        <span>{s.label}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <details className="execution-history">
                    <summary>Ход проверки</summary>
                    <ul className="execution-steps">
                      {steps.map((s, i) => (
                        <li className={s.state} key={i}>
                          {s.state === "done" ? (
                            <Check size={14} />
                          ) : (
                            <ArrowRight size={14} />
                          )}
                          <span>{s.label}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              {answer && (
                <div className="chat-answer">
                  <h4>Ключевой результат</h4>
                  {primary ? (
                    renderFact(primary, "primary")
                  ) : (
                    <p>{answer.summary}</p>
                  )}
                  {answer.details?.budget && (
                    <>
                      <h4>Стоимость и бюджет</h4>
                      <p className="chat-budget">
                        {answer.details.budget.value}
                      </p>
                    </>
                  )}
                  {otherFacts.length > 0 && (
                    <>
                      <h4>Основные изменения</h4>
                      {otherFacts.map((f, i) => renderFact(f, `fact-${i}`))}
                    </>
                  )}
                  <h4>Риски и компромиссы</h4>
                  {answer.details?.risks.map((f, i) =>
                    renderFact(f, `risk-${i}`),
                  )}
                  {answer.limitations.map((text, i) => (
                    <p className="chat-limitation" key={i}>
                      {text}
                    </p>
                  ))}
                  {answer.details && (
                    <>
                      <h4>Что проверить дальше</h4>
                      <ul className="next-checks">
                        {answer.details.nextChecks.map((text, i) => (
                          <li key={i}>{text}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
              {turn.error && (
                <p className="chat-error" role="alert">
                  {turn.error}
                </p>
              )}
              {turn.status === "cancelled" && !turn.error && (
                <p className="transcript-note">
                  Анализ остановлен. Полного подтверждённого ответа нет.
                </p>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
