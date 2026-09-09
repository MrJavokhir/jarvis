import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  createTask,
  deleteTask as deleteTaskRequest,
  fetchBootstrap,
  fetchOccurrences,
  fetchTask,
  setCompleted,
  updateTask,
} from "./api";
import { DayAgenda } from "./components/DayAgenda";
import { MonthCalendar, type DayStat } from "./components/MonthCalendar";
import { TaskEditor, type TaskEditorValue } from "./components/TaskEditor";
import { isoToYearMonth, monthRangeIso, todayIso, type YearMonth } from "./dates";
import { confirmAction, haptic, isInsideTelegram, setBackButton, showAlert } from "./telegram";
import type { Occurrence, TaskInput } from "./types";

const DEFAULT_NEW_TIME = "09:00";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Kutilmagan xatolik";
}

export default function App() {
  const [timezone, setTimezone] = useState<string | null>(null);
  const [today, setToday] = useState<string>(() => todayIso("Asia/Tashkent"));
  const [month, setMonth] = useState<YearMonth | null>(null);
  const [selectedIso, setSelectedIso] = useState<string | null>(null);

  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const [editor, setEditor] = useState<TaskEditorValue | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(() => new Set());

  /** Server soati bilan farq — o'tib ketgan eslatmalarni to'g'ri belgilash uchun. */
  const clockOffsetRef = useRef(0);
  /** Eskirgan so'rov javobi yangisining ustiga yozilmasligi uchun. */
  const requestIdRef = useRef(0);

  const now = () => Date.now() + clockOffsetRef.current;

  const loadMonth = useCallback(async (target: YearMonth) => {
    const requestId = (requestIdRef.current += 1);
    setLoading(true);

    try {
      const range = monthRangeIso(target);
      const response = await fetchOccurrences(range.from, range.to);
      if (requestId !== requestIdRef.current) return;

      clockOffsetRef.current = response.serverNow - Date.now();
      setOccurrences(response.occurrences);
      setTimezone(response.timezone);
      setToday(todayIso(response.timezone));
      setFatalError(null);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setFatalError(errorMessage(error));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  // Boshlang'ich yuklash: mintaqani olamiz, keyin joriy oyni ko'rsatamiz.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const bootstrap = await fetchBootstrap();
        if (cancelled) return;

        clockOffsetRef.current = bootstrap.serverNow - Date.now();
        const iso = todayIso(bootstrap.timezone);

        setTimezone(bootstrap.timezone);
        setToday(iso);
        setSelectedIso(iso);
        setMonth(isoToYearMonth(iso));
      } catch (error) {
        if (cancelled) return;
        setFatalError(errorMessage(error));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (month) void loadMonth(month);
  }, [month, loadMonth]);

  // Tahrirlash oynasi ochiq bo'lganda Telegramning "orqaga" tugmasi uni yopadi.
  useEffect(() => {
    if (!editor) {
      setBackButton(null);
      return;
    }
    setBackButton(() => setEditor(null));
    return () => setBackButton(null);
  }, [editor]);

  const statsByDate = useMemo(() => {
    const map = new Map<string, DayStat>();
    for (const occurrence of occurrences) {
      if (occurrence.cancelled) continue;
      const stat = map.get(occurrence.date) ?? { total: 0, pending: 0 };
      stat.total += 1;
      if (!occurrence.completed) stat.pending += 1;
      map.set(occurrence.date, stat);
    }
    return map;
  }, [occurrences]);

  const dayOccurrences = useMemo(
    () =>
      selectedIso
        ? occurrences
            .filter((occurrence) => occurrence.date === selectedIso)
            .sort((a, b) => a.occurrenceAt - b.occurrenceAt)
        : [],
    [occurrences, selectedIso],
  );

  const reload = useCallback(() => {
    if (month) void loadMonth(month);
  }, [month, loadMonth]);

  const handleToggle = async (occurrence: Occurrence) => {
    const key = `${occurrence.taskId}:${occurrence.occurrenceAt}`;
    if (busyKeys.has(key)) return;

    const nextCompleted = !occurrence.completed;

    setBusyKeys((previous) => new Set(previous).add(key));
    // Optimistik yangilash — tarmoq javobini kutmasdan belgini almashtiramiz.
    setOccurrences((previous) =>
      previous.map((item) =>
        item.taskId === occurrence.taskId && item.occurrenceAt === occurrence.occurrenceAt
          ? { ...item, completed: nextCompleted }
          : item,
      ),
    );

    try {
      await setCompleted(occurrence.taskId, occurrence.occurrenceAt, nextCompleted);
    } catch (error) {
      haptic("error");
      // Muvaffaqiyatsiz bo'lsa oldingi holatga qaytaramiz.
      setOccurrences((previous) =>
        previous.map((item) =>
          item.taskId === occurrence.taskId && item.occurrenceAt === occurrence.occurrenceAt
            ? { ...item, completed: occurrence.completed }
            : item,
        ),
      );
      showAlert(errorMessage(error));
    } finally {
      setBusyKeys((previous) => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
    }
  };

  const openCreate = () => {
    haptic("tap");
    setEditorError(null);
    setEditor({
      id: null,
      title: "",
      notes: null,
      date: selectedIso ?? today,
      time: DEFAULT_NEW_TIME,
      recurrence: "none",
    });
  };

  const openEdit = async (occurrence: Occurrence) => {
    setEditorError(null);
    // Avval mavjud ma'lumot bilan ochamiz, so'ng to'liq yozuvni yuklab aniqlaymiz.
    setEditor({
      id: occurrence.taskId,
      title: occurrence.title,
      notes: occurrence.notes,
      date: occurrence.date,
      time: occurrence.time,
      recurrence: occurrence.recurrence,
    });

    try {
      const detail = await fetchTask(occurrence.taskId);
      setEditor((current) =>
        current && current.id === occurrence.taskId
          ? {
              id: detail.task.id,
              title: detail.task.title,
              notes: detail.task.notes,
              date: detail.task.date,
              time: detail.task.time,
              recurrence: detail.task.recurrence,
            }
          : current,
      );
    } catch {
      // Yuklab bo'lmasa kalendardagi ma'lumot bilan davom etaveramiz.
    }
  };

  const handleSave = async (input: TaskInput) => {
    if (!editor) return;
    setSaving(true);
    setEditorError(null);

    try {
      if (editor.id === null) {
        await createTask(input);
      } else {
        await updateTask(editor.id, input);
      }

      haptic("success");
      setEditor(null);

      // Vazifa boshqa oyga ko'chgan bo'lsa o'sha oyni ochamiz.
      const target = isoToYearMonth(input.date);
      setSelectedIso(input.date);
      if (!month || target.year !== month.year || target.month !== month.month) {
        setMonth(target);
      } else {
        reload();
      }
    } catch (error) {
      haptic("error");
      setEditorError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editor?.id) return;
    if (!(await confirmAction("Eslatma o'chirilsinmi?"))) return;

    setDeleting(true);
    setEditorError(null);

    try {
      await deleteTaskRequest(editor.id);
      haptic("success");
      setEditor(null);
      reload();
    } catch (error) {
      haptic("error");
      setEditorError(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  };

  if (!isInsideTelegram && import.meta.env.PROD) {
    return (
      <div className="gate">
        <h1>Jarvis</h1>
        <p>Bu sahifa Telegram ilovasi ichida ochilishi kerak.</p>
        <p className="gate__hint">Botga o'ting va menyudan «Kalendar» tugmasini bosing.</p>
      </div>
    );
  }

  if (fatalError && occurrences.length === 0) {
    return (
      <div className="gate">
        <h1>Xatolik</h1>
        <p>{fatalError}</p>
        <button type="button" className="btn btn--primary" onClick={reload}>
          Qaytadan urinish
        </button>
      </div>
    );
  }

  if (!month || !selectedIso) {
    return (
      <div className="gate">
        <span className="gate__spinner" />
        <p>Yuklanmoqda…</p>
      </div>
    );
  }

  return (
    <div className="app">
      <MonthCalendar
        month={month}
        selectedIso={selectedIso}
        todayIso={today}
        stats={statsByDate}
        loading={loading}
        onSelect={setSelectedIso}
        onMonthChange={setMonth}
        onToday={() => {
          haptic("select");
          setSelectedIso(today);
          setMonth(isoToYearMonth(today));
        }}
      />

      <DayAgenda
        dateIso={selectedIso}
        occurrences={dayOccurrences}
        now={now()}
        busyKeys={busyKeys}
        onToggle={handleToggle}
        onEdit={openEdit}
      />

      {timezone && <p className="app__footer">Vaqt mintaqasi: {timezone}</p>}

      <button type="button" className="fab" onClick={openCreate} aria-label="Yangi eslatma">
        +
      </button>

      {editor && (
        <TaskEditor
          value={editor}
          saving={saving}
          deleting={deleting}
          error={editorError}
          seriesWarning={editor.id !== null}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
