import { useMemo } from "react";
import { buildMonthGrid, monthTitle, UZ_WEEKDAYS_SHORT, type YearMonth } from "../dates";
import { haptic } from "../telegram";

/** Bir kundagi hodisalar statistikasi — katakcha ostidagi nuqtalar uchun. */
export interface DayStat {
  total: number;
  pending: number;
}

interface MonthCalendarProps {
  month: YearMonth;
  selectedIso: string;
  todayIso: string;
  stats: ReadonlyMap<string, DayStat>;
  loading: boolean;
  onSelect: (iso: string) => void;
  onMonthChange: (month: YearMonth) => void;
  onToday: () => void;
}

const MAX_DOTS = 3;

export function MonthCalendar({
  month,
  selectedIso,
  todayIso,
  stats,
  loading,
  onSelect,
  onMonthChange,
  onToday,
}: MonthCalendarProps) {
  const cells = useMemo(() => buildMonthGrid(month.year, month.month), [month.year, month.month]);

  const step = (delta: number) => {
    haptic("select");
    const zeroBased = month.month - 1 + delta;
    onMonthChange({
      year: month.year + Math.floor(zeroBased / 12),
      month: (((zeroBased % 12) + 12) % 12) + 1,
    });
  };

  return (
    <section className="calendar" aria-label="Kalendar">
      <header className="calendar__head">
        <button
          type="button"
          className="icon-btn"
          onClick={() => step(-1)}
          aria-label="Oldingi oy"
        >
          ‹
        </button>

        <div className="calendar__title">
          <h2>{monthTitle(month)}</h2>
          {loading && <span className="calendar__spinner" aria-label="Yuklanmoqda" />}
        </div>

        <button type="button" className="icon-btn" onClick={() => step(1)} aria-label="Keyingi oy">
          ›
        </button>
      </header>

      <div className="calendar__weekdays" aria-hidden="true">
        {UZ_WEEKDAYS_SHORT.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="calendar__grid" role="grid">
        {cells.map((cell) => {
          const stat = stats.get(cell.iso);
          const isSelected = cell.iso === selectedIso;
          const isToday = cell.iso === todayIso;

          const className = [
            "day",
            cell.inMonth ? "" : "day--muted",
            isSelected ? "day--selected" : "",
            isToday ? "day--today" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              key={cell.iso}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              className={className}
              onClick={() => {
                haptic("select");
                onSelect(cell.iso);
              }}
            >
              <span className="day__number">{cell.day}</span>
              <span className="day__dots">
                {stat
                  ? Array.from({ length: Math.min(stat.total, MAX_DOTS) }, (_, index) => (
                      <i
                        key={index}
                        className={index < stat.pending ? "dot dot--pending" : "dot dot--done"}
                      />
                    ))
                  : null}
              </span>
            </button>
          );
        })}
      </div>

      {selectedIso !== todayIso && (
        <button type="button" className="calendar__today" onClick={onToday}>
          Bugunga qaytish
        </button>
      )}
    </section>
  );
}
