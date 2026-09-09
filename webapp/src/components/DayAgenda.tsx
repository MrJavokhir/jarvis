import { formatDayTitle } from "../dates";
import { haptic } from "../telegram";
import type { Occurrence, Recurrence } from "../types";

const RECURRENCE_LABEL: Record<Recurrence, string> = {
  none: "",
  daily: "Har kuni",
  weekly: "Har hafta",
  monthly: "Har oy",
  yearly: "Har yili",
};

const SOURCE_ICON: Record<Occurrence["source"], string> = {
  voice: "🎤",
  text: "💬",
  manual: "✍️",
};

interface DayAgendaProps {
  dateIso: string;
  occurrences: readonly Occurrence[];
  /** Hozirgi server vaqti — o'tib ketgan eslatmalarni ajratish uchun. */
  now: number;
  busyKeys: ReadonlySet<string>;
  onToggle: (occurrence: Occurrence) => void;
  onEdit: (occurrence: Occurrence) => void;
}

export function DayAgenda({
  dateIso,
  occurrences,
  now,
  busyKeys,
  onToggle,
  onEdit,
}: DayAgendaProps) {
  return (
    <section className="agenda" aria-label="Kun vazifalari">
      <header className="agenda__head">
        <h3>{formatDayTitle(dateIso)}</h3>
        <span className="agenda__count">
          {occurrences.length > 0 ? `${occurrences.length} ta` : ""}
        </span>
      </header>

      {occurrences.length === 0 ? (
        <p className="agenda__empty">
          Bu kunda eslatma yo'q.
          <br />
          Botga ovozli xabar yuboring yoki pastdagi <b>+</b> tugmasi orqali qo'shing.
        </p>
      ) : (
        <ul className="agenda__list">
          {occurrences.map((occurrence) => {
            const key = `${occurrence.taskId}:${occurrence.occurrenceAt}`;
            const busy = busyKeys.has(key);
            const overdue = !occurrence.completed && occurrence.occurrenceAt < now;

            const className = [
              "task",
              occurrence.completed ? "task--done" : "",
              occurrence.cancelled ? "task--cancelled" : "",
              overdue ? "task--overdue" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <li key={key} className={className}>
                <button
                  type="button"
                  className="task__check"
                  disabled={busy}
                  aria-label={occurrence.completed ? "Bajarilmagan deb belgilash" : "Bajarildi"}
                  aria-pressed={occurrence.completed}
                  onClick={() => {
                    haptic(occurrence.completed ? "tap" : "success");
                    onToggle(occurrence);
                  }}
                >
                  {busy ? <span className="task__spinner" /> : occurrence.completed ? "✓" : ""}
                </button>

                <button
                  type="button"
                  className="task__body"
                  onClick={() => {
                    haptic("tap");
                    onEdit(occurrence);
                  }}
                >
                  <span className="task__time">{occurrence.time}</span>
                  <span className="task__title">{occurrence.title}</span>

                  {occurrence.notes && <span className="task__notes">{occurrence.notes}</span>}

                  <span className="task__meta">
                    <span title="Manba">{SOURCE_ICON[occurrence.source]}</span>
                    {occurrence.recurrence !== "none" && (
                      <span className="badge">🔁 {RECURRENCE_LABEL[occurrence.recurrence]}</span>
                    )}
                    {overdue && <span className="badge badge--warn">O'tib ketdi</span>}
                    {occurrence.cancelled && <span className="badge">Bekor qilingan</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
