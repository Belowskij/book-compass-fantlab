import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowDown,
  Plus,
  Search,
  Trash2,
  RotateCcw,
  ChevronRight,
} from "lucide-react";
import type { Book, Library, Status, Work } from "./types";
import { statuses } from "./types";
import { api } from "./data";
import { listProgress, moveBook, type Plans, type ReadingList } from "./plans";
import { loadCycleProgress } from "./cycle-progress";

export interface PlanningProps {
  plans: Plans;
  changePlans: (change: (current: Plans) => Plans) => boolean;
  library: Library;
  save: (book: Book, status: Status) => void;
  openBook: (id: number) => void;
}
function progressLabel(read: number, total: number) {
  return `Прочитано ${read} из ${total}`;
}
export function Progress({ read, total }: { read: number; total: number }) {
  return (
    <div className="reading-progress">
      <span>{progressLabel(read, total)}</span>
      <progress
        max={Math.max(total, 1)}
        value={read}
        aria-label={progressLabel(read, total)}
      />
    </div>
  );
}
export function PersonalNext({
  plans,
  library,
  save,
  openBook,
  openPlans,
}: PlanningProps & { openPlans: () => void }) {
  const list = plans.lists.find((l) => l.id === plans.activeId);
  if (!list) return null;
  const p = listProgress(list, library);
  return (
    <article className="next-card personal-next">
      <div className="next-card-top">
        <span className="pill">Ваш порядок чтения</span>
        <button className="text-button" onClick={openPlans}>
          {list.name}
          <ChevronRight size={15} />
        </button>
      </div>
      {p.current && (
        <div className="reading-anchor">
          <span>Сейчас читаете</span>
          <button onClick={() => openBook(p.current!.id)}>
            {p.current.name}
          </button>
          <button
            className="text-button"
            onClick={() => save(p.current!, "read")}
          >
            Отметить прочитанной
          </button>
        </div>
      )}
      {p.next ? (
        <>
          <span className="step-label">
            {p.current ? "Затем по вашему списку" : "Следующая в вашей очереди"}
          </span>
          <button
            className="personal-next-title"
            onClick={() => openBook(p.next!.id)}
          >
            <h3>{p.next.name}</h3>
          </button>
          <p className="next-explanation">
            Книга {list.books.findIndex((b) => b.id === p.next!.id) + 1} из{" "}
            {p.total}. Порядок задан вами и может отличаться от библиографии.
          </p>
          <button
            className="button secondary"
            onClick={() => save(p.next!, "reading")}
          >
            Начать читать
          </button>
        </>
      ) : (
        <p>
          {p.current
            ? "После текущей книги новых книг в очереди нет."
            : p.total
              ? "Вся очередь прочитана."
              : "Добавьте книги в свою очередь."}
        </p>
      )}
      <Progress read={p.read} total={p.total} />
      <button className="text-button" onClick={openPlans}>
        Открыть мою очередь
      </button>
    </article>
  );
}
function freshList(name: string): ReadingList {
  return {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 120),
    books: [],
    updatedAt: new Date().toISOString(),
  };
}
export function AddToQueue({
  book,
  plans,
  changePlans,
}: Pick<PlanningProps, "plans" | "changePlans"> & { book: Book }) {
  const [selected, setSelected] = useState(
    plans.activeId ?? plans.lists[0]?.id ?? "",
  );
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  if (book.isGroup) return null;
  const target = plans.lists.find((l) => l.id === selected);
  return (
    <details className="add-to-queue">
      <summary>Добавить в мою очередь</summary>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          const list = target ?? (name.trim() ? freshList(name) : undefined);
          if (!list) return;
          if (list.books.some((b) => b.id === book.id)) {
            setMessage("Эта книга уже в очереди.");
            return;
          }
          const changed = {
            ...list,
            books: [...list.books, book],
            updatedAt: new Date().toISOString(),
          };
          if (
            changePlans((p) => ({
              ...p,
              activeId: p.activeId ?? list.id,
              lists: target
                ? p.lists.map((l) => (l.id === list.id ? changed : l))
                : [...p.lists, changed],
            }))
          ) {
            setSelected(list.id);
            setName("");
            setMessage(`Добавлено в «${list.name}».`);
          }
        }}
      >
        <label>
          Очередь
          <select
            aria-label="Выбрать очередь"
            value={target ? selected : ""}
            onChange={(e) => {
              setSelected(e.target.value);
              setMessage("");
            }}
          >
            <option value="">Новая очередь</option>
            {plans.lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        {!target && (
          <label>
            Название
            <input
              value={name}
              maxLength={120}
              required
              onChange={(e) => setName(e.target.value)}
              placeholder="Например, мой маршрут по Warhammer"
            />
          </label>
        )}
        <button className="button secondary" type="submit">
          Добавить книгу
        </button>
      </form>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
function ListEditor({ list, ...props }: PlanningProps & { list: ReadingList }) {
  const { plans, changePlans, library, save, openBook } = props;
  const [name, setName] = useState(list.name);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Book[]>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [submitted, setSubmitted] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removed, setRemoved] = useState<{ book: Book; position: number }>();
  const request = useRef(0);
  useEffect(() => {
    setName(list.name);
  }, [list.name]);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const patch = (change: (l: ReadingList) => ReadingList) =>
    changePlans((p) => ({
      ...p,
      lists: p.lists.map((l) => (l.id === list.id ? change(l) : l)),
    }));
  const add = (book: Book) =>
    patch((l) =>
      l.books.some((b) => b.id === book.id)
        ? l
        : {
            ...l,
            books: [...l.books, book],
            updatedAt: new Date().toISOString(),
          },
    );
  const search = async (q: string, p: number) => {
    const token = ++request.current;
    setLoading(true);
    setError("");
    setSubmitted(q);
    setPage(p);
    try {
      const r = await api<{ books: Book[]; total: number }>("search", {
        q,
        kind: "works",
        page: p,
      });
      if (request.current === token) {
        setResults(r.books.filter((b) => !b.isGroup));
        setTotal(r.total);
      }
    } catch (e) {
      if (request.current === token) {
        setError((e as Error).message);
        setResults(undefined);
      }
    } finally {
      if (request.current === token) setLoading(false);
    }
  };
  const p = listProgress(list, library);
  const available = Object.values(library)
    .map((i) => i.book)
    .filter(
      (b) =>
        !b.isGroup &&
        !list.books.some((row) => row.id === b.id) &&
        b.name
          .toLocaleLowerCase("ru")
          .includes(query.trim().toLocaleLowerCase("ru")),
    )
    .slice(0, 10);
  return (
    <article className="reading-list-editor">
      <div className="queue-heading">
        <h3>{list.name}</h3>
        <span className="pill">
          {plans.activeId === list.id
            ? "Вы следуете этой очереди"
            : "Личная очередь"}
        </span>
      </div>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim())
            patch((l) => ({
              ...l,
              name: name.trim(),
              updatedAt: new Date().toISOString(),
            }));
        }}
      >
        <label>
          Название очереди
          <input
            aria-label={`Название очереди «${list.name}»`}
            value={name}
            maxLength={120}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="button secondary">Переименовать</button>
      </form>
      <Progress read={p.read} total={p.total} />
      <div className="queue-actions">
        <button
          className="button secondary"
          disabled={plans.activeId === list.id}
          onClick={() =>
            changePlans((state) => ({ ...state, activeId: list.id }))
          }
        >
          Следовать этой очереди
        </button>
        {plans.activeId === list.id && (
          <button
            className="text-button"
            onClick={() =>
              changePlans((state) => ({ ...state, activeId: undefined }))
            }
          >
            Пока не следовать
          </button>
        )}
        <button
          className="text-button delete"
          onClick={() => setConfirmDelete(true)}
        >
          Удалить очередь
        </button>
      </div>
      {confirmDelete && (
        <div className="inline-confirm">
          <p>
            Удалить очередь «{list.name}»? Книги и их статусы в библиотеке
            сохранятся.
          </p>
          <button
            className="button secondary"
            onClick={() =>
              changePlans((state) => ({
                ...state,
                lists: state.lists.filter((l) => l.id !== list.id),
                activeId:
                  state.activeId === list.id ? undefined : state.activeId,
              }))
            }
          >
            Да, удалить очередь
          </button>
          <button
            className="text-button"
            onClick={() => setConfirmDelete(false)}
          >
            Отмена
          </button>
        </div>
      )}
      <ol className="queue-books">
        {list.books.map((book, index) => (
          <li key={book.id} className="queue-book">
            <span className="queue-number">{index + 1}</span>
            <div className="queue-book-main">
              <button
                className="queue-book-title"
                onClick={() => openBook(book.id)}
              >
                {book.name}
              </button>
              <span>{book.authors.map((a) => a.name).join(", ")}</span>
              <label
                className="sr-only"
                htmlFor={`queue-status-${list.id}-${book.id}`}
              >
                Статус книги «{book.name}» в очереди
              </label>
              <select
                id={`queue-status-${list.id}-${book.id}`}
                value={library[book.id]?.status ?? "unread"}
                onChange={(e) => save(book, e.target.value as Status)}
              >
                {Object.entries(statuses).map(([s, label]) => (
                  <option key={s} value={s}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="queue-order-controls">
              <button
                disabled={index === 0}
                aria-label={`Поднять «${book.name}»`}
                onClick={() => patch((l) => moveBook(l, book.id, index - 1))}
              >
                <ArrowUp size={18} />
              </button>
              <button
                disabled={index === list.books.length - 1}
                aria-label={`Опустить «${book.name}»`}
                onClick={() => patch((l) => moveBook(l, book.id, index + 1))}
              >
                <ArrowDown size={18} />
              </button>
              <label>
                Место
                <input
                  key={index}
                  aria-label={`Место книги «${book.name}»`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={list.books.length}
                  defaultValue={index + 1}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  onBlur={(e) => {
                    const position = Number(e.target.value);
                    if (
                      Number.isInteger(position) &&
                      position >= 1 &&
                      position <= list.books.length
                    ) {
                      if (position !== index + 1)
                        patch((l) => moveBook(l, book.id, position - 1));
                    } else e.target.value = String(index + 1);
                  }}
                />
              </label>
              <button
                aria-label={`Убрать «${book.name}» из очереди`}
                onClick={() => {
                  if (
                    patch((l) => ({
                      ...l,
                      books: l.books.filter((b) => b.id !== book.id),
                      updatedAt: new Date().toISOString(),
                    }))
                  )
                    setRemoved({ book, position: index });
                }}
              >
                <XIcon />
              </button>
            </div>
          </li>
        ))}
      </ol>
      {removed && (
        <div className="inline-confirm">
          <p>«{removed.book.name}» убрана из очереди.</p>
          <button
            className="text-button"
            onClick={() => {
              if (
                patch((l) => {
                  if (l.books.some((b) => b.id === removed.book.id)) return l;
                  const books = [...l.books];
                  books.splice(
                    Math.min(removed.position, books.length),
                    0,
                    removed.book,
                  );
                  return { ...l, books, updatedAt: new Date().toISOString() };
                })
              )
                setRemoved(undefined);
            }}
          >
            Отменить удаление из очереди
          </button>
        </div>
      )}
      {!list.books.length && (
        <p className="muted-block">
          Очередь пуста. Добавьте только те книги, которые хотите прочитать.
        </p>
      )}
      <details className="queue-add" open>
        <summary>Добавить книги в очередь</summary>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim().length >= 2) void search(query.trim(), 1);
          }}
        >
          <label>
            Название книги
            <input
              aria-label={`Найти книгу для очереди «${list.name}»`}
              value={query}
              minLength={2}
              maxLength={120}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по ФантЛабу"
            />
          </label>
          <button className="button secondary" disabled={loading}>
            <Search size={16} />
            Найти книги
          </button>
        </form>
        {!!available.length && (
          <div className="queue-picks">
            <h4>Из вашей библиотеки</h4>
            {available.map((b) => (
              <button key={b.id} onClick={() => add(b)}>
                <span>{b.name}</span>
                <Plus size={17} />
              </button>
            ))}
          </div>
        )}
        {loading && <p role="status">Ищем книги на ФантЛабе…</p>}
        {error && <p role="alert">{error}</p>}
        {results && !loading && (
          <div className="queue-picks">
            <h4>Результаты ФантЛаба</h4>
            {results.map((b) => (
              <button
                key={b.id}
                disabled={list.books.some((row) => row.id === b.id)}
                onClick={() => add(b)}
              >
                <span>
                  {b.name}
                  <small>{b.authors.map((a) => a.name).join(", ")}</small>
                </span>
                {list.books.some((row) => row.id === b.id) ? (
                  "Добавлено"
                ) : (
                  <Plus size={17} />
                )}
              </button>
            ))}
            {!results.length && (
              <p>
                Отдельных произведений на этой странице не найдено. Попробуйте
                другое название или следующую страницу.
              </p>
            )}
            <div className="queue-actions">
              <button
                className="text-button"
                disabled={page <= 1}
                onClick={() => void search(submitted, page - 1)}
              >
                Назад
              </button>
              <span>Страница {page}</span>
              <button
                className="text-button"
                disabled={page >= 40 || page * 25 >= total}
                onClick={() => void search(submitted, page + 1)}
              >
                Далее
              </button>
            </div>
          </div>
        )}
      </details>
    </article>
  );
}
function XIcon() {
  return <span aria-hidden="true">×</span>;
}
export function ReadingPlans(props: PlanningProps) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string>();
  const shown =
    props.plans.lists.find((l) => l.id === selected) ??
    props.plans.lists.find((l) => l.id === props.plans.activeId) ??
    props.plans.lists[0];
  return (
    <section className="section reading-plans">
      <h2>Мои очереди чтения</h2>
      <p className="section-description queue-description">
        Соберите свой маршрут по Warhammer или любому другому миру. Здесь
        действуют ваш выбор книг и ваш порядок.
      </p>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const list = freshList(name);
          if (
            props.changePlans((p) => ({
              ...p,
              lists: [...p.lists, list],
              activeId: p.activeId ?? list.id,
            }))
          ) {
            setName("");
            setSelected(list.id);
          }
        }}
      >
        <label>
          Новая очередь
          <input
            aria-label="Название новой очереди"
            placeholder="Например, мой Warhammer"
            maxLength={120}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="button secondary">
          <Plus size={16} />
          Создать очередь
        </button>
      </form>
      {!props.plans.lists.length && (
        <p className="muted-block">
          Создайте очередь, добавьте книги и расставьте их в нужном порядке.
          Добавлять в библиотеку все книги вселенной не требуется.
        </p>
      )}
      <div className="queue-list-switcher" aria-label="Ваши очереди">
        {props.plans.lists.map((list) => (
          <button
            key={list.id}
            aria-pressed={shown?.id === list.id}
            onClick={() => setSelected(list.id)}
          >
            {list.name}
          </button>
        ))}
      </div>
      {shown && <ListEditor key={shown.id} list={shown} {...props} />}
      <p className="fine-print">
        Очереди хранятся на этом устройстве и входят в JSON-экспорт библиотеки.
        Удаление книги из очереди не меняет её статус в библиотеке.
      </p>
    </section>
  );
}
export function RemovedBooks({
  plans,
  library,
  restore,
}: {
  plans: Plans;
  library: Library;
  restore: (id: number) => void;
}) {
  const rows = plans.removed.filter((row) => !library[row.item.book.id]);
  return (
    <section className="section">
      <h2>Удалённые книги</h2>
      <p className="section-description queue-description">
        Здесь остаются последние 50 удалённых книг. Можно восстановить книгу с
        прежним статусом после перезагрузки страницы.
      </p>
      {!rows.length && <p className="muted-block">Удалённых книг пока нет.</p>}
      {rows.map((row) => (
        <article key={row.item.book.id} className="removed-row">
          <div>
            <h3>{row.item.book.name}</h3>
            <p>
              {statuses[row.item.status]} · удалено{" "}
              {new Date(row.deletedAt).toLocaleDateString("ru-RU")}
            </p>
          </div>
          <button
            className="button secondary"
            aria-label={`Восстановить «${row.item.book.name}»`}
            onClick={() => restore(row.item.book.id)}
          >
            <RotateCcw size={16} />
            Восстановить
          </button>
        </article>
      ))}
    </section>
  );
}
export function CycleShelf({
  library,
  openBook,
}: {
  library: Library;
  openBook: (id: number) => void;
}) {
  const [data, setData] =
    useState<Awaited<ReturnType<typeof loadCycleProgress>>>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [q, setQ] = useState("");
  const signature = JSON.stringify(
    Object.values(library).map((i) => [
      i.book.id,
      i.status,
      i.updatedAt,
      i.parents,
      i.book.cycles,
    ]),
  );
  useEffect(() => {
    let active = true;
    setData(undefined);
    setError("");
    void loadCycleProgress(library, (id) => api<Work>("work", { id }))
      .then((r) => {
        if (active) setData(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [signature, retry]);
  const rows = data?.rows.filter((r) =>
    r.cycle.name.toLocaleLowerCase("ru").includes(q.toLocaleLowerCase("ru")),
  );
  return (
    <section className="section">
      <h2>Прогресс по циклам</h2>
      <p className="section-description queue-description">
        Общий прогресс включает опубликованные произведения и подциклы из
        библиографии ФантЛаба. Все книги остаются отдельными записями.
      </p>
      <label className="cycle-shelf-search">
        Найти цикл
        <input
          aria-label="Найти цикл в библиотеке"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Название цикла"
        />
      </label>
      {!data && !error && (
        <p role="status">Проверяем состав циклов на ФантЛабе…</p>
      )}
      {error && <p role="alert">{error}</p>}
      {rows?.map((row) => {
        const read = row.books.filter(
          (b) => library[b.id]?.status === "read",
        ).length;
        const current = row.books.filter(
          (b) => library[b.id]?.status === "reading",
        );
        return (
          <article key={row.cycle.id} className="cycle-progress-card">
            <button
              className="queue-book-title"
              onClick={() => openBook(row.cycle.id)}
            >
              <h3>{row.cycle.name}</h3>
              <ChevronRight size={18} />
            </button>
            <Progress read={read} total={row.books.length} />
            {current.length > 0 && (
              <p>Сейчас читаете: {current.map((b) => b.name).join(", ")}</p>
            )}
            {read === row.books.length && (
              <span className="pill">Цикл прочитан</span>
            )}
          </article>
        );
      })}
      {data && !rows?.length && (
        <p className="muted-block">
          {q
            ? "Такой цикл не найден."
            : "Циклы пока не найдены. Добавьте книгу из цикла в библиотеку."}
        </p>
      )}
      {!!data?.errors.length && <p role="alert">{data.errors.join(" ")}</p>}
      {(error || !!data?.errors.length) && (
        <button className="text-button" onClick={() => setRetry((n) => n + 1)}>
          Повторить загрузку циклов
        </button>
      )}
      {data?.limited && (
        <p className="fine-print">
          За один проход проверяются до 60 книг и 20 циклов, текущее чтение — в
          первую очередь.
        </p>
      )}
    </section>
  );
}
