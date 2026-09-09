import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Recurrence, TaskInput } from "../types";

const RECURRENCE_OPTIONS: ReadonlyArray<{ value: Recurrence; label: string }> = [
  { value: "none", label: "Takrorlanmaydi" },
  { value: "daily", label: "Har kuni" },
  { value: "weekly", label: "Har hafta" },
  { value: "monthly", label: "Har oy" },
  { value: "yearly", label: "Har yili" },
];

export interface TaskEditorValue extends TaskInput {
  /** Mavjud vazifani tahrirlashda uning id'si; yangi vazifada `null`. */
  id: number | null;
}

interface TaskEditorProps {
  value: TaskEditorValue;
  saving: boolean;
  deleting: boolean;
  error: string | null;
  /** Takrorlanuvchi vazifani tahrirlashda butun seriya o'zgarishini ogohlantirish uchun. */
  seriesWarning: boolean;
  onSave: (input: TaskInput) => void;
  onDelete: () => void;
  onClose: () => void;
}

const TITLE_MAX = 120;
const NOTES_MAX = 1000;

export function TaskEditor({
  value,
  saving,
  deleting,
  error,
  seriesWarning,
  onSave,
  onDelete,
  onClose,
}: TaskEditorProps) {
  const [title, setTitle] = useState(value.title);
  const [notes, setNotes] = useState(value.notes ?? "");
  const [date, setDate] = useState(value.date);
  const [time, setTime] = useState(value.time);
  const [recurrence, setRecurrence] = useState<Recurrence>(value.recurrence);
  const [touched, setTouched] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);

  // Boshqa vazifa tanlanganda maydonlarni yangilaymiz.
  useEffect(() => {
    setTitle(value.title);
    setNotes(value.notes ?? "");
    setDate(value.date);
    setTime(value.time);
    setRecurrence(value.recurrence);
    setTouched(false);
  }, [value]);

  useEffect(() => {
    if (value.id === null) titleRef.current?.focus();
  }, [value.id]);

  const trimmedTitle = title.trim();
  const valid = trimmedTitle.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time);
  const busy = saving || deleting;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!valid || busy) return;

    onSave({
      title: trimmedTitle.slice(0, TITLE_MAX),
      notes: notes.trim() ? notes.trim().slice(0, NOTES_MAX) : null,
      date,
      time,
      recurrence,
    });
  };

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Eslatma">
      <div className="sheet__backdrop" onClick={busy ? undefined : onClose} />

      <form className="sheet__panel" onSubmit={submit}>
        <div className="sheet__grip" />

        <h3 className="sheet__title">
          {value.id === null ? "Yangi eslatma" : "Eslatmani tahrirlash"}
        </h3>

        <label className="field">
          <span className="field__label">Nomi</span>
          <input
            ref={titleRef}
            className="field__input"
            value={title}
            maxLength={TITLE_MAX}
            placeholder="Masalan: Shifokorga borish"
            onChange={(event) => setTitle(event.target.value)}
            disabled={busy}
          />
          {touched && !trimmedTitle && <span className="field__error">Nomini kiriting</span>}
        </label>

        <div className="field-row">
          <label className="field">
            <span className="field__label">Sana</span>
            <input
              type="date"
              className="field__input"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={busy}
            />
          </label>

          <label className="field">
            <span className="field__label">Vaqt</span>
            <input
              type="time"
              className="field__input"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              disabled={busy}
            />
          </label>
        </div>

        <label className="field">
          <span className="field__label">Takrorlanish</span>
          <select
            className="field__input"
            value={recurrence}
            onChange={(event) => setRecurrence(event.target.value as Recurrence)}
            disabled={busy}
          >
            {RECURRENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Izoh (ixtiyoriy)</span>
          <textarea
            className="field__input field__input--area"
            value={notes}
            maxLength={NOTES_MAX}
            rows={3}
            placeholder="Qo'shimcha tafsilot"
            onChange={(event) => setNotes(event.target.value)}
            disabled={busy}
          />
        </label>

        {seriesWarning && recurrence !== "none" && (
          <p className="sheet__hint">
            Bu takrorlanuvchi eslatma — o'zgarish butun seriyaga tegishli bo'ladi.
          </p>
        )}

        {error && <p className="sheet__error">{error}</p>}

        <div className="sheet__actions">
          {value.id !== null && (
            <button
              type="button"
              className="btn btn--danger"
              onClick={onDelete}
              disabled={busy}
            >
              {deleting ? "O'chirilmoqda…" : "O'chirish"}
            </button>
          )}

          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Bekor qilish
          </button>

          <button type="submit" className="btn btn--primary" disabled={busy || !valid}>
            {saving ? "Saqlanmoqda…" : "Saqlash"}
          </button>
        </div>
      </form>
    </div>
  );
}
