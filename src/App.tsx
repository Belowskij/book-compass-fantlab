import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import {
  Compass,
  Search,
  Library as LibraryIcon,
  Sparkles,
  ArrowUpRight,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Plus,
  Check,
  Download,
  Upload,
  Trash2,
  ExternalLink,
  Route,
  House,
  X,
  LoaderCircle,
  AlertCircle,
  Bookmark,
  Info,
  SlidersHorizontal,
} from "lucide-react";
import type {
  Book,
  Work,
  Author,
  Library,
  Status,
  CycleRef,
  LibraryItem,
} from "./types";
import { statuses } from "./types";
import { continuations, activeItems, type Suggestion } from "./recommendations";
import {
  SearchFilters,
  useSearchMetadata,
  SeedPicker,
  type Filters,
} from "./Discovery";
import { matchesFilters, continuation } from "./data";
import { readLibrary, writeLibrary, readRecoverySource, recoveryIssues } from "./storage";
import { readPlans, writePlans, serializeWorkspace, importPlans, type Plans } from "./plans";
import { AddToQueue, PersonalNext, ReadingPlans, RemovedBooks, CycleShelf, Progress } from "./Planning";
import {
  descendants,
  isCycleRead,
  expandCycle,
  markCycleRead,
} from "./library";
import {
  api,
  validateImport,
  nextBook,
  cycleRefs,
  sequence,
} from "./data";
type Page = "home" | "search" | "library" | "recommendations";
type RouteState = { page: Page; id?: number; author?: number; q?: string };
function getRoute(): RouteState {
  const u = new URL(location.href);
  const page = u.searchParams.get("page");
  return {
    page: ["search", "library", "recommendations"].includes(page ?? "")
      ? (page as Page)
      : "home",
    id: Number(u.searchParams.get("book")) || undefined,
    author: Number(u.searchParams.get("author")) || undefined,
    q: u.searchParams.get("q") ?? undefined,
  };
}
const nav = [
  { id: "home", label: "Главная", icon: House },
  { id: "search", label: "Поиск", icon: Search },
  { id: "library", label: "Моя библиотека", icon: LibraryIcon },
  { id: "recommendations", label: "Рекомендации", icon: Sparkles },
] as const;
function useResource<T>(key: string, loader: () => Promise<T>) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setData(undefined);
    setError("");
    setLoading(true);
    loader()
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [key, retry]);
  return { data, error, loading, reload: () => setRetry((n) => n + 1) };
}
function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={23} />
      <span>Ищем путь к книгам…</span>
    </div>
  );
}
function downloadRecovery(raw: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "knizhny-kompas-recovery.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function ErrorBox({ text, retry, dismiss, children }: { text: string; retry?: () => void; dismiss?: () => void; children?: ReactNode }) {
  return (
    <div className="error" role="alert">
      <AlertCircle size={21} />
      <div className="error-copy">
        <p>{text}</p>
        <div className="error-actions">{retry && (
          <button className="text-button" onClick={retry}>
            Попробовать ещё раз
          </button>
        )}
        {children}</div>
      </div>
      {dismiss && <button className="notice-close" onClick={dismiss} aria-label="Закрыть сообщение о библиотеке"><X size={20} /></button>}
    </div>
  );
}
function Empty({
  icon = <BookOpen size={30} />,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
function Cover({ book, large = false }: { book: Book; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [book.image]);
  return (
    <div className={`cover ${large ? "large" : ""}`}>
      {book.image && !failed ? (
        <img
          src={book.image}
          alt={`Обложка «${book.name}»`}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="cover-fallback">
          <BookOpen size={large ? 42 : 26} />
          <span>{book.name}</span>
        </div>
      )}
    </div>
  );
}
function Rating({ book }: { book: Book }) {
  return book.rating ? (
    <span className="rating">
      <span>★</span> {book.rating.toFixed(2)}
      <span className="sr-only"> — рейтинг ФантЛаба</span>
    </span>
  ) : null;
}
interface Common {
  library: Library;
  openBook: (id: number) => void;
  save: (book: Book, status: Status, parents?: CycleRef[]) => void;
  savingIds: ReadonlySet<number>;
  plans: Plans;
  changePlans: (change: (current: Plans) => Plans) => boolean;
  openPlans: () => void;
}
function BookCard({
  book,
  library,
  openBook,
  save,
  reason,
}: { book: Book; reason?: string } & Common) {
  const item = library[book.id];
  return (
    <article className="book-card">
      {reason && (
        <div className="card-reason">
          <Route size={13} />
          {reason}
        </div>
      )}
      <button className="book-open" onClick={() => openBook(book.id)}>
        <Cover book={book} />
        <div className="book-card-body">
          <p className="eyebrow">
            {book.kind}
            {book.year ? ` · ${book.year}` : ""}
          </p>
          <h3>{book.name}</h3>
          <p className="author-name">
            {book.authors.map((a) => a.name).join(", ") || "Автор не указан"}
          </p>
          <Rating book={book} />
          {book.volume && (
            <p className="book-volume">
              {book.volume.pages <= 250
                ? "До 250 страниц"
                : book.volume.pages <= 500
                  ? "251–500 страниц"
                  : "Более 500 страниц"}{" "}
              · по изданию
            </p>
          )}
        </div>
      </button>
      <button
        className={`save-button ${item ? "saved" : ""}`}
        aria-label={
          item
            ? `${book.name}: ${statuses[item.status]}`
            : `Добавить «${book.name}» в планы`
        }
        onClick={() => save(book, item ? item.status : "want")}
      >
        {item ? (
          <>
            <Check size={15} />
            {statuses[item.status]}
          </>
        ) : (
          <>
            <Plus size={16} />В планы
          </>
        )}
      </button>
    </article>
  );
}
function BookGrid({ books, ...common }: { books: Book[] } & Common) {
  return (
    <div className="book-grid">
      {books.map((b) => (
        <BookCard key={b.id} book={b} {...common} />
      ))}
    </div>
  );
}
function SectionTitle({
  label,
  title,
  action,
}: {
  label?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        {label && <p className="eyebrow accent">{label}</p>}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}
function NextReads({
  library,
  openBook,
  save,
  compact = false,
  plans,
  changePlans,
  openPlans,
}: { compact?: boolean } & Common) {
  const readItems = activeItems(library).filter(
    (i) => !i.book.isGroup || i.status === "reading",
  );
  const key = JSON.stringify(
    readItems.map((i) => [
      i.book.id,
      i.status,
      i.updatedAt,
      i.parents,
      i.book.cycles,
    ]),
  );
  const result = useResource<{
    suggestions: Suggestion[];
    errors: string[];
    checked: number;
  }>(key, () => continuations(library, (id) => api<Work>("work", { id })));
  const personal = <PersonalNext plans={plans} changePlans={changePlans} library={library} save={save} openBook={openBook} openPlans={openPlans}/>;
  if (!readItems.length)
    return (
      <>{personal}
      <Empty icon={<Route size={29} />} title="Продолжения появятся здесь">
        <p>
          Добавьте книгу со статусом «Читаю» или «Прочитано». В первую очередь
          компас предложит продолжение того, что вы читаете сейчас.
        </p>
      </Empty></>
    );
  return (
    <>
      {personal}
      {result.loading ? (
        <Loading />
      ) : result.error ? (
        <ErrorBox text={result.error} retry={result.reload} />
      ) : (
        <>
          {result.data?.suggestions.length ? (
            <div className="next-grid">
              {result.data.suggestions.slice(0, compact ? 2 : 8).map((s) => (
                <article className="next-card" key={s.book.id}>
                  <div className="next-card-top">
                    <span className="pill">
                      <Route size={13} />
                      {s.priority
                        ? s.anchor
                          ? "После текущей книги"
                          : "Читаемый цикл"
                        : s.gap
                          ? "Пропущено в цикле"
                          : "Следующая в цикле"}
                    </span>
                    <button
                      className="text-button"
                      onClick={() => openBook(s.cycle.id)}
                    >
                      {s.cycle.name}
                      <ChevronRight size={14} />
                    </button>
                  </div>
                  {s.anchor && <div className="reading-anchor"><span>Сейчас читаете</span><button onClick={() => openBook(s.anchor!.id)}>{s.anchor.name}</button><button className="text-button" onClick={() => save(s.anchor!, "read")}>Отметить прочитанной</button></div>}
                  <p className="step-label">{s.anchor ? "Затем по библиографии ФантЛаба" : "Следующая непрочитанная"}</p>
                  <button
                    className="next-book"
                    onClick={() => openBook(s.book.id)}
                  >
                    <Cover book={s.book} />
                    <div>
                      <h3>{s.book.name}</h3>
                      <p>{s.book.authors.map((a) => a.name).join(", ")}</p>
                      <p className="next-explanation">
                        {s.anchor
                          ? `Следующая непрочитанная после «${s.anchor.name}», которую вы сейчас читаете.`
                          : s.priority
                            ? "Следующая непрочитанная в цикле, который вы сейчас читаете."
                            : s.gap
                              ? "Ранее в библиографии есть непрочитанное произведение."
                              : "Следующая непрочитанная книга по порядку библиографии ФантЛаба."}
                      </p>
                      <p className="next-basis">
                        {s.anchor
                          ? `Сейчас читаете: ${s.anchor.name}.`
                          : `На основе вашего чтения: ${
                              s.basis
                                .map((b) => b.name)
                                .slice(0, 3)
                                .join(", ") || s.cycle.name
                            }.`}
                      </p>
                      <span className="accent inline-link">
                        Открыть книгу <ArrowUpRight size={16} />
                      </span>
                    </div>
                  </button>
                  <p className="next-basis">Книга {s.position} из {s.total} · порядок библиографии ФантЛаба</p>
                  <Progress read={s.readCount} total={s.total}/>
                  <button
                    className="text-button start-reading"
                    onClick={() =>
                      save(s.book, "reading", [
                        {
                          id: s.cycle.id,
                          name: s.cycle.name,
                          kind: s.cycle.kind,
                        },
                      ])
                    }
                  >
                    {library[s.book.id]?.status === "reading"
                      ? "Вы уже читаете эту книгу"
                      : "Начать читать"}
                    <BookOpen size={15} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            !result.data?.errors.length && (
              <Empty title="Продолжения пока не найдены">
                <p>
                  В проверенных циклах всё прочитано или у книг нет доступного
                  порядка. Похожие произведения можно посмотреть в
                  рекомендациях.
                </p>
              </Empty>
            )
          )}
          {!!result.data?.errors.length && (
            <ErrorBox
              text={result.data.errors.join(" ")}
              retry={result.reload}
            />
          )}
          <p className="fine-print">
            Порядок библиографии не всегда совпадает с внутренней хронологией.{" "}
            {readItems.length > 12
              ? "Проверены до 12 книг и 8 циклов; текущему чтению отдан приоритет."
              : ""}
          </p>
        </>
      )}
    </>
  );
}
function Home({
  go,
  ...common
}: { go: (page: Page, q?: string) => void } & Common) {
  const featured = useResource<{ books: Book[] }>("featured", () =>
    api("featured"),
  );
  const items = Object.values(common.library);
  return (
    <>
      <section className="hero">
        <div className="hero-content">
          <span className="hero-kicker">
            <span />
            ВАША СЛЕДУЮЩАЯ ИСТОРИЯ
          </span>
          <h1>
            Хорошая книга —<br />
            только начало.
          </h1>
          <p>
            Находите новые миры. Исследуйте циклы.
            <br className="desktop-break" /> Всегда знайте, что читать дальше.
          </p>
          <button className="button hero-button" onClick={() => go("search")}>
            Найти свою книгу <ArrowUpRight size={19} />
          </button>
          <div className="hero-note">
            <Compass size={14} />
            По данным ФантЛаба
          </div>
        </div>
        <div className="compass-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="orbit orbit-three" />
          <span className="compass-north">С</span>
          <span className="compass-south">Ю</span>
          <span className="compass-east">В</span>
          <span className="compass-west">З</span>
          <div className="needle" />
          <div className="needle-center" />
          <div className="art-caption">МЕЖДУ СТРОК — ЦЕЛЫЕ МИРЫ</div>
        </div>
      </section>
      <div className="home-overview">
        <p>
          <span className="tiny-icon">
            <Bookmark size={17} />
          </span>
          {items.length ? (
            <>
              <strong>{items.length}</strong>{" "}
              {items.length === 1
                ? "книга в вашем компасе"
                : "книг в вашем компасе"}
            </>
          ) : (
            "Ваша история чтения начинается здесь"
          )}
        </p>
        <button className="text-button" onClick={() => go("library")}>
          Моя библиотека <ArrowRight size={16} />
        </button>
      </div>
      <section className="section">
        <SectionTitle
          label="ПРОДОЛЖАЕМ ПУТЬ"
          title="Что читать дальше"
          action={
            <span className="section-icon">
              <Route size={22} />
            </span>
          }
        />
        <NextReads {...common} compact />
      </section>
      <section className="section">
        <SectionTitle
          label="ОТКРОЙТЕ ДЛЯ СЕБЯ"
          title="В большие книжные миры"
          action={
            <button className="text-button" onClick={() => go("search")}>
              Все книги <ArrowRight size={16} />
            </button>
          }
        />
        <p className="section-description">
          Несколько отправных точек для нового путешествия.
        </p>
        {featured.loading ? (
          <Loading />
        ) : featured.error ? (
          <ErrorBox text={featured.error} retry={featured.reload} />
        ) : (
          <BookGrid books={featured.data?.books ?? []} {...common} />
        )}
      </section>
      <section className="explore">
        <div>
          <p className="eyebrow accent">КУДА ОТПРАВИМСЯ?</p>
          <h2>Миры на любой вкус</h2>
        </div>
        <div className="topic-list">
          {["Дюна", "Ведьмак", "Основание", "Тёмная Башня"].map((q, i) => (
            <button key={q} onClick={() => go("search", q)}>
              <span className="topic-number">0{i + 1}</span>
              {q}
              <ArrowUpRight size={17} />
            </button>
          ))}
        </div>
      </section>
      <div className="source-note">
        <Info size={16} />
        <p>
          Книжный компас помогает ориентироваться в книгах. Библиографии,
          аннотации, обложки и рейтинги —{" "}
          <a href="https://fantlab.ru" target="_blank" rel="noreferrer">
            ФантЛаб
          </a>
          .
        </p>
      </div>
    </>
  );
}
function SearchPage({
  initialQuery,
  ...common
}: { initialQuery?: string } & Common) {
  const [q, setQ] = useState(initialQuery ?? "");
  const [query, setQuery] = useState(initialQuery ?? "");
  const [kind, setKind] = useState<"works" | "authors">("works");
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    type: "all",
    genre: undefined,
    volume: "all",
  });
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setQ(initialQuery ?? "");
    setQuery(initialQuery ?? "");
    setPage(1);
  }, [initialQuery]);
  const r = useResource<{
    books: Book[];
    authors: Author[];
    total: number;
    warning?: string;
  }>(`${query}:${kind}:${page}`, () =>
    query.length >= 2
      ? api("search", { q: query, kind, page })
      : Promise.resolve({ books: [], authors: [], total: 0 }),
  );
  const metadata = useSearchMetadata(
    r.data?.books ?? [],
    filtersOpen && kind === "works" && !r.loading,
  );
  const filteredBooks = (r.data?.books ?? [])
    .map((b) => {
      const detail = metadata.details.get(b.id);
      return detail
        ? {
            ...b,
            genres: detail.genres,
            volume: detail.volume,
            cycles: detail.cycles,
          }
        : b;
    })
    .filter((b) => {
      if (
        (filters.genre || filters.volume !== "all") &&
        !metadata.details.has(b.id)
      )
        return false;
      return matchesFilters(
        b,
        filters.type,
        filters.genre?.id ?? 0,
        filters.volume,
      );
    });
  const hasFilters =
    filters.type !== "all" || !!filters.genre || filters.volume !== "all";
  const authorOpen = (id: number) => {
    const u = new URL(location.href);
    u.searchParams.set("author", String(id));
    history.pushState({}, "", u);
    dispatchEvent(new PopStateEvent("popstate"));
  };
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow accent">ОТ НАЗВАНИЯ — К ЦЕЛОЙ ВСЕЛЕННОЙ</p>
        <h1>Найдите свою историю</h1>
        <p>Книги и авторы в библиографии ФантЛаба</p>
      </div>
      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
          setPage(1);
          input.current?.blur();
        }}
      >
        <Search size={22} />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          minLength={2}
          maxLength={120}
          aria-label="Название книги или имя автора"
          placeholder="Название книги или имя автора"
          enterKeyHint="search"
          required
        />
        {q && (
          <button
            type="button"
            className="icon-button"
            aria-label="Очистить поиск"
            onClick={() => {
              setQ("");
              setQuery("");
              setPage(1);
              input.current?.focus();
            }}
          >
            <X size={18} />
          </button>
        )}
        <button className="button" type="submit">
          Найти
        </button>
      </form>
      <div className="tabs" role="tablist" aria-label="Тип поиска">
        {[
          ["works", "Произведения"],
          ["authors", "Авторы"],
        ].map(([id, label]) => (
          <button
            role="tab"
            aria-selected={kind === id}
            className={kind === id ? "active" : ""}
            key={id}
            onClick={() => {
              setKind(id as typeof kind);
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {kind === "works" && (
        <SearchFilters
          open={filtersOpen}
          toggle={() => setFiltersOpen((v) => !v)}
          filters={filters}
          setFilters={setFilters}
          metadata={metadata}
        />
      )}
      {!query ? (
        <>
          <div className="search-suggestions">
            <span>Например:</span>
            {["Дюна", "Гиперион", "Стругацкие", "Лем"].map((t) => (
              <button
                key={t}
                onClick={() => {
                  setQ(t);
                  setQuery(t);
                  setPage(1);
                }}
              >
                {t}
                <ArrowUpRight size={13} />
              </button>
            ))}
          </div>
          <Empty
            icon={<Search size={29} />}
            title="Тысячи историй. Одна — ваша."
          >
            <p>
              Введите русское название книги или имя автора.
              <br />
              Можно искать циклы, романы и рассказы.
            </p>
          </Empty>
        </>
      ) : r.loading ? (
        <Loading />
      ) : r.error ? (
        <ErrorBox text={r.error} retry={r.reload} />
      ) : (
        <>
          {r.data?.warning && <ErrorBox text={r.data.warning} />}
          <div className="results-caption">
            <h2>Результаты поиска</h2>
            <span>
              {hasFilters && kind === "works"
                ? `${filteredBooks.length} из ${r.data?.books.length ?? 0} на странице`
                : `${r.data?.total ?? 0} найдено`}
            </span>
          </div>
          {!(r.data?.books.length || r.data?.authors.length) ? (
            <Empty title="Ничего не нашлось">
              <p>
                Попробуйте другое название, фамилию автора или более короткий
                запрос.
              </p>
            </Empty>
          ) : kind === "works" ? (
            filteredBooks.length ? (
              <BookGrid books={filteredBooks} {...common} />
            ) : (
              <Empty title="На этой странице нет совпадений">
                <p>
                  {metadata.progress.done < metadata.total
                    ? "Жанры и объём ещё уточняются. Результаты будут появляться по мере загрузки."
                    : "Измените фильтры или перейдите на другую страницу результатов."}
                </p>
              </Empty>
            )
          ) : (
            <div className="author-grid">
              {r.data?.authors.map((a) => (
                <button
                  className="author-card"
                  key={a.id}
                  onClick={() => authorOpen(a.id)}
                >
                  {a.image ? (
                    <img src={a.image} alt={a.name} />
                  ) : (
                    <div className="author-placeholder">
                      <BookOpen />
                    </div>
                  )}
                  <div>
                    <h3>{a.name}</h3>
                    <p>{a.description || "Открыть библиографию"}</p>
                  </div>
                  <ChevronRight size={18} />
                </button>
              ))}
            </div>
          )}
          {(page > 1 || (r.data?.total ?? 0) > page * 25) && (
            <div className="pagination">
              <button
                className="button secondary"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft size={16} />
                Назад
              </button>
              <span>Страница {page}</span>
              <button
                className="button secondary"
                disabled={(r.data?.total ?? 0) <= page * 25 || page >= 40}
                onClick={() => setPage((p) => p + 1)}
              >
                Далее
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
function LibraryPage({
  remove,
  importLibrary,
  notify,
  ...common
}: {
  remove: (id: number) => void;
  importLibrary: (lib: Library, plans?: Plans) => void;
  notify: (s: string) => void;
} & Common) {
  const [filter, setFilter] = useState<Status | "all">("all");
  const [fileError, setFileError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const items = Object.values(common.library).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const shown = items.filter((i) => filter === "all" || i.status === filter);
  const download = () => {
    const u = URL.createObjectURL(
      new Blob([serializeWorkspace(common.library, common.plans)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = u;
    a.download = `knizhny-kompas-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
    notify("Библиотека экспортирована в JSON");
  };
  return (
    <>
      <div className="page-heading library-heading">
        <div>
          <p className="eyebrow accent">ВАШ ЛИЧНЫЙ МАРШРУТ</p>
          <h1>Моя библиотека</h1>
          <p>Книги, к которым хочется возвращаться</p>
        </div>
        <div className="library-tools">
          <button className="button secondary" onClick={download}>
            <Download size={16} />
            Экспорт
          </button>
          <button
            className="button secondary"
            onClick={() => file.current?.click()}
          >
            <Upload size={16} />
            Импорт
          </button>
          <input
            className="sr-only"
            type="file"
            ref={file}
            accept="application/json,.json"
            aria-label="Импорт библиотеки JSON"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setFileError("");
              try {
                if (f.size > 5 * 1024 * 1024)
                  throw new Error("Файл слишком большой. Максимум — 5 МБ.");
                const data = JSON.parse(await f.text());
                const lib = validateImport(data);
                const plans = importPlans(data);
                importLibrary(lib, plans);
              } catch (error) {
                setFileError(
                  error instanceof SyntaxError
                    ? "Не удалось прочитать JSON-файл. Библиотека не изменена."
                    : (error as Error).message,
                );
              }
              e.target.value = "";
            }}
          />
        </div>
      </div>
      <div className="library-stats">
        {(["read", "reading", "want"] as Status[]).map((s) => (
          <button key={s} onClick={() => setFilter(s)}>
            <strong>{items.filter((i) => i.status === s).length}</strong>
            <span>{statuses[s]}</span>
          </button>
        ))}
      </div>
      <div className="filter-list">
        <SlidersHorizontal size={16} />
        {(["all", "reading", "want", "read", "unread"] as const).map((s) => (
          <button
            key={s}
            className={filter === s ? "active" : ""}
            onClick={() => setFilter(s)}
          >
            {s === "all" ? "Все книги" : statuses[s]}
            <span>
              {s === "all"
                ? items.length
                : items.filter((i) => i.status === s).length}
            </span>
          </button>
        ))}
      </div>
      {fileError && <ErrorBox text={fileError} />}
      <p className="fine-print library-help">
        Библиотека хранится только в этом браузере. Экспортируйте JSON для
        переноса и резервной копии. Импорт объединит списки; совпавшие книги
        получат статус из файла.
      </p>
      {!shown.length ? (
        <Empty
          icon={<LibraryIcon size={30} />}
          title={
            items.length
              ? "На этой полке пока пусто"
              : "Место для ваших историй"
          }
        >
          <p>
            {items.length
              ? "Выберите другой статус или добавьте книгу на эту полку."
              : "Найдите книгу и добавьте её в планы. Прочитанные книги помогут выбрать продолжение."}
          </p>
          <button
            className="button secondary"
            onClick={() => {
              history.pushState({}, "", "/?page=search");
              dispatchEvent(new PopStateEvent("popstate"));
            }}
          >
            Найти книгу <Search size={16} />
          </button>
        </Empty>
      ) : (
        <div className="library-list">
          {shown.map((item) => (
            <article key={item.book.id} className="library-row">
              <button
                className="library-book"
                onClick={() => common.openBook(item.book.id)}
              >
                <Cover book={item.book} />
                <div>
                  <h3>{item.book.name}</h3>
                  <p>{item.book.authors.map((a) => a.name).join(", ")}</p>
                  <Rating book={item.book} />
                </div>
              </button>
              <div className="library-row-actions">
                <label className="sr-only" htmlFor={`status-${item.book.id}`}>
                  Статус книги «{item.book.name}»
                </label>
                <select
                  id={`status-${item.book.id}`}
                  value={item.status}
                  onChange={(e) =>
                    common.save(
                      item.book,
                      e.target.value as Status,
                      item.parents,
                    )
                  }
                >
                  {Object.entries(statuses).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  className="icon-button delete"
                  aria-label={`Удалить «${item.book.name}» из библиотеки`}
                  onClick={() => remove(item.book.id)}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
function Similar({ id, ...common }: { id: number } & Common) {
  const r = useResource<{ books: Book[] }>(String(id), () =>
    api("similar", { id }),
  );
  return r.loading ? (
    <Loading />
  ) : r.error ? (
    <ErrorBox text={r.error} retry={r.reload} />
  ) : r.data?.books.length ? (
    <BookGrid books={r.data.books.slice(0, 12)} {...common} />
  ) : (
    <p className="muted-block">
      Для этого произведения или цикла ФантЛаб не вернул похожих.
    </p>
  );
}
function Recommendations(common: Common) {
  const seed = activeItems(common.library);
  const [choice, setChoice] = useState<number>();
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow accent">ПУСТЬ ИСТОРИЯ ПРОДОЛЖАЕТСЯ</p>
        <h1>Ваш следующий поворот</h1>
        <p>Продолжения циклов и новые литературные знакомства</p>
      </div>
      <section className="section">
        <SectionTitle title="Дальше по циклу" />
        <NextReads {...common} />
      </section>
      <section className="section">
        <SectionTitle
          label="ЕСЛИ ВАМ ПОНРАВИЛОСЬ"
          title="Похожие произведения"
        />
        <p className="section-description">
          Похожие книги и циклы по мнению читателей ФантЛаба. Сходство не
          означает общую вселенную.
        </p>
        {seed.length ? (
          <>
            <SeedPicker
              library={common.library}
              selectedId={choice}
              onSelect={setChoice}
            />
            {choice && <Similar key={choice} id={choice} {...common} />}
          </>
        ) : (
          <Empty
            icon={<Sparkles size={30} />}
            title="Сначала познакомимся с вашим чтением"
          >
            <p>
              Добавьте книгу со статусом «Читаю» или «Прочитано», и здесь
              появятся похожие произведения из ФантЛаба.
            </p>
          </Empty>
        )}
      </section>
    </>
  );
}
function WorkPage({
  id,
  back,
  remove,
  ...common
}: { id: number; back: () => void; remove: (id: number) => void } & Common) {
  const r = useResource<Work>(String(id), () => api("work", { id }));
  const [tab, setTab] = useState<"about" | "similar">("about");
  useEffect(() => setTab("about"), [id]);
  if (r.loading)
    return (
      <>
        <button className="back-button" onClick={back}>
          <ChevronLeft size={17} />
          Назад
        </button>
        <Loading />
      </>
    );
  if (r.error || !r.data)
    return (
      <>
        <button className="back-button" onClick={back}>
          <ChevronLeft size={17} />
          Назад
        </button>
        <ErrorBox text={r.error || "Книга не найдена"} retry={r.reload} />
      </>
    );
  const w = r.data;
  const item = common.library[w.id];
  const allRead = w.isGroup && isCycleRead(w.children, common.library);
  const workStatus = item?.status ?? (allRead ? "read" : "");
  const next = w.isGroup ? nextBook(w.children, common.library) : undefined;
  return (
    <>
      <button className="back-button" onClick={back}>
        <ChevronLeft size={17} />
        Назад
      </button>
      <section className="work-hero">
        <Cover book={w} large />
        <div className="work-intro">
          <p className="eyebrow accent">
            {w.kind}
            {w.year ? ` · ${w.year}` : ""}
          </p>
          <h1>{w.name}</h1>
          <div className="work-authors">
            {w.authors.map((a) => (
              <button
                key={a.id}
                className="text-button"
                onClick={() => {
                  const u = new URL(location.href);
                  u.searchParams.delete("book");
                  u.searchParams.set("author", String(a.id));
                  history.pushState({}, "", u);
                  dispatchEvent(new PopStateEvent("popstate"));
                  window.scrollTo(0, 0);
                }}
              >
                {a.name}
                <ArrowUpRight size={14} />
              </button>
            ))}
          </div>
          <div className="work-rating">
            <Rating book={w} />
            <span>
              {w.voters
                ? `${w.voters.toLocaleString("ru-RU")} оценок на ФантЛабе`
                : "Нет оценок на ФантЛабе"}
            </span>
          </div>
          <div className="work-status">
            <label htmlFor="work-status">
              {w.isGroup
                ? "Статус цикла"
                : item
                  ? "В вашей библиотеке"
                  : "Добавить в библиотеку"}
            </label>
            <select
              id="work-status"
              value={workStatus}
              disabled={common.savingIds.has(w.id)}
              onChange={(e) => {
                if (e.target.value)
                  common.save(w, e.target.value as Status, cycleRefs(w));
              }}
            >
              <option value="" disabled>
                Выбрать статус
              </option>
              {Object.entries(statuses).map(([s, label]) => (
                <option key={s} value={s}>
                  {w.isGroup && s === "read"
                    ? allRead
                      ? "Весь цикл прочитан"
                      : "Отметить весь цикл прочитанным"
                    : label}
                </option>
              ))}
            </select>
            {w.isGroup && (
              <p className="cycle-status-help">
                «Весь цикл прочитан» добавит в прочитанные все опубликованные
                произведения, включая подциклы. Сам цикл отдельной книгой не
                считается.
              </p>
            )}
            {item && (
              <button
                className="text-button delete"
                onClick={() => remove(w.id)}
              >
                <Trash2 size={14} />
                Убрать из библиотеки
              </button>
            )}
          </div>
          <a
            className="source-link"
            href={`https://fantlab.ru/work${w.id}`}
            target="_blank"
            rel="noreferrer"
          >
            Открыть на ФантЛабе
            <ExternalLink size={14} />
          </a>
        </div>
      </section>
      <AddToQueue book={w} plans={common.plans} changePlans={common.changePlans}/>
      <div className="tabs" role="tablist" aria-label="О книге">
        <button
          role="tab"
          aria-selected={tab === "about"}
          className={tab === "about" ? "active" : ""}
          onClick={() => setTab("about")}
        >
          О произведении
        </button>
        <button
          role="tab"
          aria-selected={tab === "similar"}
          className={tab === "similar" ? "active" : ""}
          onClick={() => setTab("similar")}
        >
          Похожие книги
        </button>
      </div>
      {tab === "similar" ? (
        <section className="section">
          <p className="section-description">
            Похожие произведения по мнению читателей ФантЛаба. Сходство не
            означает общую вселенную.
          </p>
          <Similar id={w.id} {...common} />
        </section>
      ) : (
        <>
          <section className="section prose">
            <h2>О чём эта история</h2>
            <p>
              {w.description ||
                "В API ФантЛаба нет аннотации для этого произведения."}
            </p>
            {!!w.genres?.length && (
              <div className="genre-tags" aria-label="Жанры">
                {w.genres.map((g) => (
                  <span key={g.id}>{g.name}</span>
                ))}
              </div>
            )}
            {w.volume && (
              <p className="volume-source">
                Объём: {w.volume.pages} стр. в издании{" "}
                <a
                  href={`https://fantlab.ru/edition${w.volume.editionId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  «{w.volume.editionName}»
                </a>
                . У других изданий число страниц может отличаться.
              </p>
            )}
            {w.notes && (
              <details>
                <summary>Примечания ФантЛаба</summary>
                <p>{w.notes}</p>
              </details>
            )}
          </section>
          {(w.parents.length > 0 || w.roots.length > 0) && (
            <section className="section">
              <SectionTitle
                label="КАРТА СВЯЗЕЙ"
                title="Часть большой истории"
              />
              <p className="section-description">
                Принадлежность к циклам подтверждена библиографией ФантЛаба.
              </p>
              <div className="cycle-paths">
                {(w.parents.length ? w.parents : [w.roots]).map((chain, i) => (
                  <div className="cycle-path" key={i}>
                    {chain.map((c, j) => (
                      <div key={`${c.id}-${j}`} className="cycle-step">
                        <span className="path-dot" />
                        <button onClick={() => common.openBook(c.id)}>
                          <span className="eyebrow">{c.kind}</span>
                          <strong>{c.name}</strong>
                          <ChevronRight size={17} />
                        </button>
                      </div>
                    ))}
                    <div className="cycle-step current">
                      <span className="path-dot" />
                      <div>
                        <span className="eyebrow">Вы здесь</span>
                        <strong>{w.name}</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          {w.children.length > 0 && (
            <section className="section">
              <SectionTitle
                label={
                  w.isGroup ? "ВАШ МАРШРУТ ЧТЕНИЯ" : "ПОДТВЕРЖДЁННЫЕ СВЯЗИ"
                }
                title={w.isGroup ? "Порядок в цикле" : "Входит в произведение"}
              />
              <p className="section-description">
                {w.isGroup
                  ? "Порядок и вложенность библиографии ФантЛаба. Это не отдельная внутренняя хронология."
                  : "Состав произведения по данным ФантЛаба. Части и отрывки не считаются отдельными следующими томами."}
              </p>
              {next && (
                <div className="next-banner">
                  <Route size={22} />
                  <div>
                    <span>
                      {continuation(w.children, common.library).anchor
                        ? "Следующая после текущей книги"
                        : "Первая непрочитанная по библиографии"}
                    </span>
                    <button onClick={() => common.openBook(next.id)}>
                      {next.name}
                      <ArrowRight size={17} />
                    </button>
                  </div>
                </div>
              )}
              <div className="cycle-list">
                {w.children.map((b, i) => (
                  <div
                    className={`cycle-row ${b.isGroup ? "group-row" : ""}`}
                    key={`${b.id}-${i}`}
                    style={
                      {
                        "--depth": Math.min(Math.max(b.depth - 1, 0), 4),
                      } as React.CSSProperties
                    }
                  >
                    <button
                      className="cycle-book"
                      onClick={() => common.openBook(b.id)}
                    >
                      <span className="cycle-marker">
                        {common.library[b.id]?.status === "read" ||
                        (b.isGroup &&
                          isCycleRead(
                            descendants(w.children, i),
                            common.library,
                          )) ? (
                          <Check size={17} />
                        ) : b.isGroup ? (
                          <LibraryIcon size={17} />
                        ) : (
                          <BookOpen size={17} />
                        )}
                      </span>
                      <div>
                        <h3>{b.name}</h3>
                        <p>
                          {b.kind}
                          {b.year ? ` · ${b.year}` : ""}
                          {b.note ? ` · ${b.note}` : ""}
                          {!b.published ? " · Не опубликовано" : ""}
                        </p>
                      </div>
                    </button>
                    <label className="sr-only" htmlFor={`cycle-${b.id}-${i}`}>
                      Статус: {b.name}
                    </label>
                    <select
                      id={`cycle-${b.id}-${i}`}
                      value={
                        b.isGroup &&
                        isCycleRead(descendants(w.children, i), common.library)
                          ? "read"
                          : (common.library[b.id]?.status ?? "")
                      }
                      disabled={common.savingIds.has(b.id)}
                      onChange={(e) =>
                        common.save(b, e.target.value as Status, [
                          { id: w.id, name: w.name, kind: w.kind },
                        ])
                      }
                    >
                      <option value="" disabled>
                        Статус
                      </option>
                      {Object.entries(statuses).map(([s, label]) => (
                        <option key={s} value={s}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </section>
          )}
          <p className="fine-print relation-limit">
            <Info size={15} />
            API не даёт надёжной карты персонажей и всех межцикловых связей.
            Здесь показаны только доступные библиографические связи.
          </p>
        </>
      )}
    </>
  );
}
function AuthorPage({
  id,
  back,
  ...common
}: { id: number; back: () => void } & Common) {
  const r = useResource<Author>(String(id), () => api("author", { id }));
  return (
    <>
      <button className="back-button" onClick={back}>
        <ChevronLeft size={17} />
        Назад
      </button>
      {r.loading ? (
        <Loading />
      ) : r.error ? (
        <ErrorBox text={r.error} retry={r.reload} />
      ) : (
        r.data && (
          <>
            <div className="page-heading">
              <p className="eyebrow accent">АВТОР · ФАНТЛАБ</p>
              <h1>{r.data.name}</h1>
              <p>
                {r.data.description?.slice(0, 1200) ||
                  "Описание автора недоступно в API."}
              </p>
              <a
                className="source-link"
                href={`https://fantlab.ru/autor${r.data.id}`}
                target="_blank"
                rel="noreferrer"
              >
                Страница автора
                <ExternalLink size={14} />
              </a>
            </div>
            <SectionTitle title="Библиография" />
            <p className="section-description">
              Циклы и отдельные произведения. Откройте цикл, чтобы увидеть его
              вложенную структуру.
            </p>
            {r.data.books?.length ? (
              <BookGrid books={r.data.books} {...common} />
            ) : (
              <Empty title="Библиография недоступна">
                <p>
                  API не вернул список произведений. Попробуйте поиск по
                  названию книги.
                </p>
              </Empty>
            )}
          </>
        )
      )}
    </>
  );
}
export default function App() {
  const [route, setRoute] = useState(getRoute);
  const [initial] = useState(readLibrary);
  const [library, setLibrary] = useState<Library>(initial.library);
  const libraryRef = useRef(library);
  const [initialPlans] = useState(readPlans);
  const [plans, setPlans] = useState<Plans>(initialPlans.plans);
  const plansRef = useRef(plans);
  const [plansError, setPlansError] = useState(initialPlans.error ?? "");
  const [libraryView, setLibraryView] = useState<"books" | "cycles" | "plans" | "removed">("books");
  const changePlans = useCallback((change: (current: Plans) => Plans) => {
    const next = change(plansRef.current);
    try { writePlans(next); }
    catch { setPlansError("Не удалось сохранить очереди или удалённые книги. Память сайта недоступна, заполнена или содержит нераспознанные данные. Изменение не сохранено."); return false; }
    plansRef.current = next; setPlans(next); setPlansError(""); return true;
  }, []);
  const [savingIds, setSavingIds] = useState<ReadonlySet<number>>(new Set());
  const [cycleError, setCycleError] = useState<{
    book: Book;
    message: string;
  }>();
  const operations = useRef(new Map<number, symbol>());
  const failedMigrations = useRef(new Map<number, LibraryItem>());
  const [storageError, setStorageError] = useState(initial.error ?? initial.warning ?? "");
  const [storageSource, setStorageSource] = useState(() => initial.error || initial.warning ? initial.raw : readRecoverySource());
  const [storageNoticeDismissed, setStorageNoticeDismissed] = useState(false);
  const [toast, setToast] = useState("");
  const [undo, setUndo] = useState<LibraryItem>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = useCallback((message: string) => {
    setToast(message);
    setUndo(undefined);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setToast("");
      setUndo(undefined);
    }, 6000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const onPop = () => setRoute(getRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = route.id
      ? "Книга — Книжный компас"
      : `${nav.find((n) => n.id === route.page)?.label} — Книжный компас`;
  }, [route.page, route.id, route.author]);
  const update = useCallback(
    (change: Library | ((current: Library) => Library), allowRecovery = false) => {
      const next =
        typeof change === "function" ? change(libraryRef.current) : change;
      try {
        writeLibrary(next, undefined, allowRecovery);
        setStorageError("");
      } catch (error) {
        setStorageNoticeDismissed(false);
        setStorageError(
          error instanceof Error && !(error instanceof DOMException)
            ? error.message
            : "Изменение не сохранено: браузер запретил запись или память сайта заполнена. Ранее сохранённые книги не перезаписаны.",
        );
        return false;
      }
      libraryRef.current = next;
      setLibrary(next);
      return true;
    },
    [],
  );
  const saveCycle = useCallback(
    async (book: Book, previous?: LibraryItem) => {
      const token = Symbol();
      operations.current.set(book.id, token);
      setSavingIds((ids) => new Set([...ids, book.id]));
      setCycleError(undefined);
      const changedAt = previous?.updatedAt ?? new Date().toISOString();
      try {
        const expanded = await expandCycle(book, (id) =>
          api<Work>("work", { id }),
        );
        if (operations.current.get(book.id) !== token) return;
        if (previous && libraryRef.current[book.id] !== previous) return;
        if (!update((current) => markCycleRead(current, expanded, changedAt)))
          throw new Error("Изменение не сохранено. Проверьте сообщение о памяти сайта выше.");
        failedMigrations.current.delete(book.id);
        notify(
          `«${book.name}»: прочитано произведений — ${expanded.books.length}`,
        );
      } catch (error) {
        if (operations.current.get(book.id) !== token) return;
        if (previous) failedMigrations.current.set(book.id, previous);
        setCycleError({
          book,
          message: `Не удалось отметить цикл «${book.name}». ${(error as Error).message}`,
        });
      } finally {
        if (operations.current.get(book.id) === token) {
          operations.current.delete(book.id);
          setSavingIds(
            (ids) => new Set([...ids].filter((id) => id !== book.id)),
          );
        }
      }
    },
    [notify, update],
  );
  // Upgrade old cycle-as-book records and imported libraries without changing later book edits.
  useEffect(() => {
    if (savingIds.size) return;
    const previous = Object.values(library).find(
      (item) =>
        item.book.isGroup &&
        item.status === "read" &&
        failedMigrations.current.get(item.book.id) !== item,
    );
    if (previous) void saveCycle(previous.book, previous);
  }, [library, savingIds, saveCycle]);
  const save = (book: Book, status: Status, parents?: CycleRef[]) => {
    if (book.isGroup && status === "read") {
      void saveCycle(book);
      return;
    }
    // A newer explicit action cancels any pending expansion of this cycle.
    operations.current.delete(book.id);
    setSavingIds((ids) => new Set([...ids].filter((id) => id !== book.id)));
    const saved = update((current) => ({
      ...current,
      [book.id]: {
        book,
        status,
        parents: parents ?? current[book.id]?.parents ?? [],
        updatedAt: new Date().toISOString(),
      },
    }));
    if (saved) notify(`«${book.name}» → ${statuses[status]}`);
  };
  const remove = (id: number) => {
    operations.current.delete(id);
    setSavingIds((ids) => new Set([...ids].filter((value) => value !== id)));
    const prev = libraryRef.current[id];
    if (!prev) return;
    const previousPlans = plansRef.current;
    if (!changePlans(current => ({...current, removed: [{item: prev, deletedAt: new Date().toISOString()}, ...current.removed.filter(row => row.item.book.id !== id)].slice(0,50)}))) return;
    const saved = update((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (saved) {
      notify("Книга удалена из библиотеки");
      setUndo(prev);
    } else changePlans(() => previousPlans);
  };
  const restore = (id: number) => {
    const row = plansRef.current.removed.find(row => row.item.book.id === id);
    if (!row) return;
    if (update(current => ({...current, [id]: current[id] ?? row.item}))) {
      changePlans(current => ({...current, removed: current.removed.filter(row => row.item.book.id !== id)}));
      notify("Книга восстановлена с прежним статусом");
    }
  };
  const navigate = (state: RouteState) => {
    const u = new URL(location.origin);
    if (state.page !== "home") u.searchParams.set("page", state.page);
    if (state.id) u.searchParams.set("book", String(state.id));
    if (state.q) u.searchParams.set("q", state.q);
    history.pushState({}, "", u);
    setRoute(state);
  };
  const go = (page: Page, q?: string) => navigate({ page, q });
  const common = {
    library,
    save,
    savingIds,
    plans,
    changePlans,
    openPlans: () => { setLibraryView("plans"); navigate({ page: "library" }); },
    openBook: (id: number) => navigate({ ...route, id, author: undefined }),
  };
  const back = () => {
    if (history.state?.compass) history.back();
    else if (history.length > 1) history.back();
    else navigate({ page: route.page });
  };
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <button
            className="brand"
            onClick={() => go("home")}
            aria-label="Книжный компас — главная"
          >
            <span className="brand-icon">
              <Compass size={25} strokeWidth={1.5} />
            </span>
            <span>
              Книжный<span className="brand-second">компас</span>
            </span>
          </button>
          <nav className="desktop-nav" aria-label="Основная навигация">
            {nav.map((n) => (
              <button
                key={n.id}
                className={
                  route.page === n.id && !route.id && !route.author
                    ? "active"
                    : ""
                }
                onClick={() => go(n.id)}
              >
                <n.icon size={17} />
                {n.label}
              </button>
            ))}
          </nav>
          <span className="header-caption">Всегда есть что читать</span>
        </div>
      </header>
      <main className="main" id="main">
        {plansError && <ErrorBox text={plansError}/>}
        {storageError && !storageNoticeDismissed && (
          <ErrorBox text={storageError} dismiss={() => setStorageNoticeDismissed(true)} retry={() => {
            const restored = readLibrary();
            setStorageSource(restored.raw);
            setStorageError(restored.error ?? restored.warning ?? "");
            setStorageNoticeDismissed(false);
            if (!restored.error) {
              libraryRef.current = restored.library;
              setLibrary(restored.library);
            }
          }}>
            {storageSource && <button className="text-button" onClick={() => downloadRecovery(storageSource)}>Скачать исходные данные для восстановления</button>}
          </ErrorBox>
        )}
        {cycleError && (
          <ErrorBox
            text={cycleError.message}
            retry={() => void saveCycle(cycleError.book)}
          />
        )}
        {savingIds.size > 0 && (
          <div className="cycle-progress" role="status">
            <LoaderCircle className="spin" size={18} />
            <span>Проверяем состав цикла и отмечаем произведения…</span>
          </div>
        )}
        {route.id ? (
          <WorkPage
            key={route.id}
            id={route.id}
            back={back}
            remove={remove}
            {...common}
          />
        ) : route.author ? (
          <AuthorPage
            key={route.author}
            id={route.author}
            back={back}
            {...common}
          />
        ) : route.page === "home" ? (
          <Home go={go} {...common} />
        ) : route.page === "search" ? (
          <SearchPage initialQuery={route.q} {...common} />
        ) : route.page === "library" ? (
          <>
          <div className="library-view-tabs" role="tablist" aria-label="Разделы библиотеки">{([
            ["books", "Книги"], ["cycles", "Циклы"], ["plans", "Мои очереди"], ["removed", "Удалённые"]
          ] as const).map(([id,label])=><button key={id} role="tab" aria-selected={libraryView===id} onClick={()=>setLibraryView(id)}>{label}{id==="removed"&&plans.removed.filter(row=>!library[row.item.book.id]).length>0?` (${plans.removed.filter(row=>!library[row.item.book.id]).length})`:""}</button>)}</div>
          {libraryView === "books" ? (
          <LibraryPage
            remove={remove}
            importLibrary={(lib, imported) => {
              if (imported && !changePlans(current => ({...current,
                lists: [...current.lists.filter(list => !imported.lists.some(other=>other.id===list.id)), ...imported.lists],
                removed: [...imported.removed, ...current.removed.filter(row=>!imported.removed.some(other=>other.item.book.id===row.item.book.id))].slice(0,50),
                activeId: imported.activeId ?? current.activeId,
              }))) return;
              if (update((current) => ({ ...current, ...lib }), true))
                notify(`Импортировано книг: ${Object.keys(lib).length}`);
            }}
            notify={notify}
            {...common}
          />
          ) : libraryView === "cycles" ? <CycleShelf library={library} openBook={common.openBook}/>
            : libraryView === "plans" ? <ReadingPlans {...common}/>
            : <RemovedBooks plans={plans} library={library} restore={restore}/>}
          </>
        ) : (
          <Recommendations {...common} />
        )}
        {route.page === "library" && !route.id && !route.author && storageSource && (
          <details className="recovery-details">
            <summary>Восстановление библиотеки</summary>
            <p>Исходные данные доступны для восстановления нераспознанных записей. Закрытие уведомления их не удаляет.</p>
            {recoveryIssues(storageSource).map(issue=><p key={issue.index}><strong>Запись {issue.index}: {issue.name}.</strong> {issue.reason}</p>)}
            <button className="text-button" onClick={() => downloadRecovery(storageSource)}>Скачать исходные данные для восстановления</button>
          </details>
        )}
      </main>
      <footer className="site-footer">
        <span>
          <Compass size={15} />
          Книжный компас
        </span>
        <p>Больше историй. Меньше потерянных страниц.</p>
        <a href="https://fantlab.ru" target="_blank" rel="noreferrer">
          Данные ФантЛаба <ExternalLink size={12} />
        </a>
      </footer>
      <nav className="mobile-nav" aria-label="Мобильная навигация">
        {nav.map((n) => (
          <button
            key={n.id}
            className={route.page === n.id ? "active" : ""}
            aria-current={route.page === n.id ? "page" : undefined}
            onClick={() => go(n.id)}
          >
            <n.icon size={21} strokeWidth={route.page === n.id ? 2.2 : 1.6} />
            <span>{n.id === "library" ? "Библиотека" : n.label}</span>
          </button>
        ))}
      </nav>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          {undo && (
            <button
              onClick={() => {
                restore(undo.book.id);
              }}
            >
              Отменить удаление
            </button>
          )}
          <button
            aria-label="Закрыть уведомление"
            onClick={() => {
              setToast("");
              setUndo(undefined);
            }}
          >
            <X size={17} />
          </button>
        </div>
      )}
    </>
  );
}
