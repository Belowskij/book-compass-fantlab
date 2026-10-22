import { useEffect, useState } from "react";
import {
  Search,
  SlidersHorizontal,
  ChevronRight,
  Library as LibraryIcon,
  BookOpen,
} from "lucide-react";
import type { Book, Genre, Library, Work } from "./types";
import { api, cleanCycleRefs, type VolumeGrade } from "./data";
import { activeItems, buildSeeds, filterSeeds, pool } from "./recommendations";

export function useSearchMetadata(books: Book[], enabled: boolean) {
  const key = books.map((b) => b.id).join(",");
  const [details, setDetails] = useState(new Map<number, Work>());
  const [progress, setProgress] = useState({ done: 0, failed: 0 });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setDetails(new Map());
    setProgress({ done: 0, failed: 0 });
    void pool(books, 4, async (b) => {
      if (!active) return;
      let failed = false;
      try {
        const detail = await api<Work>("work", { id: b.id });
        if (active) setDetails((prev) => new Map(prev).set(b.id, detail));
      } catch {
        failed = true;
      } finally {
        if (active)
          setProgress((prev) => ({
            done: prev.done + 1,
            failed: prev.failed + Number(failed),
          }));
      }
    });
    return () => {
      active = false;
    };
  }, [key, enabled, retry]);
  return {
    details,
    progress,
    reload: () => setRetry((n) => n + 1),
    total: books.length,
  };
}
export interface Filters {
  type: string;
  genre: Genre | undefined;
  volume: VolumeGrade;
}
export function SearchFilters({
  open,
  toggle,
  filters,
  setFilters,
  metadata,
}: {
  open: boolean;
  toggle: () => void;
  filters: Filters;
  setFilters: (f: Filters) => void;
  metadata: ReturnType<typeof useSearchMetadata>;
}) {
  const genres = new Map<number, Genre>();
  if (filters.genre) genres.set(filters.genre.id, filters.genre);
  for (const detail of metadata.details.values())
    for (const g of detail.genres ?? []) genres.set(g.id, g);
  const active =
    Number(filters.type !== "all") +
    Number(!!filters.genre) +
    Number(filters.volume !== "all");
  return (
    <div className="search-filter-area">
      <button
        className={`filter-toggle ${open ? "selected" : ""}`}
        onClick={toggle}
        aria-expanded={open}
        aria-controls="search-filters"
      >
        <SlidersHorizontal size={17} />
        Фильтры{active > 0 && <span>{active}</span>}
      </button>
      {open && (
        <div id="search-filters" className="search-filters">
          <div className="filter-fields">
            <label>
              Тип произведения
              <select
                aria-label="Тип произведения"
                value={filters.type}
                onChange={(e) =>
                  setFilters({ ...filters, type: e.target.value })
                }
              >
                <option value="all">Все произведения</option>
                <option value="cycles">Только циклы</option>
                <option value="single">Без циклов</option>
              </select>
            </label>
            <label>
              Жанр
              <select
                aria-label="Жанр"
                value={filters.genre?.id ?? 0}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    genre: genres.get(Number(e.target.value)),
                  })
                }
              >
                <option value="0">Все жанры</option>
                {[...genres.values()]
                  .sort((a, b) => a.name.localeCompare(b.name, "ru"))
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Объём по изданию
              <select
                aria-label="Объём по изданию"
                value={filters.volume}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    volume: e.target.value as VolumeGrade,
                  })
                }
              >
                <option value="all">Любой объём</option>
                <option value="short">До 250 страниц</option>
                <option value="medium">251–500 страниц</option>
                <option value="long">Более 500 страниц</option>
                <option value="unknown">Объём не указан</option>
              </select>
            </label>
          </div>
          <p className="filter-scope">
            Фильтры применяются к результатам текущей страницы (до 25
            произведений). Жанры — по классификации читателей ФантЛаба; страницы
            — по отдельному русскому изданию. Общий объём цикла и время чтения
            не указаны.
          </p>
          {metadata.progress.done < metadata.total && (
            <p role="status" className="filter-progress">
              Уточняем жанры и объём: {metadata.progress.done} из{" "}
              {metadata.total}…
            </p>
          )}
          {metadata.progress.failed > 0 && (
            <div className="filter-failure" role="status">
              <p>
                Для {metadata.progress.failed} произведений данные пока
                недоступны. При фильтрации по жанру или объёму они не
                учитываются.
              </p>
              <button className="text-button" onClick={metadata.reload}>
                Повторить загрузку
              </button>
            </div>
          )}
          {active > 0 && (
            <button
              className="text-button"
              onClick={() =>
                setFilters({ type: "all", genre: undefined, volume: "all" })
              }
            >
              Сбросить фильтры
            </button>
          )}
        </div>
      )}
    </div>
  );
}
export function SeedPicker({
  library,
  onSelect,
  selectedId,
}: {
  library: Library;
  onSelect: (id: number) => void;
  selectedId?: number;
}) {
  const items = activeItems(library);
  const key = JSON.stringify(
    items.map((i) => [
      i.book.id,
      i.status,
      i.updatedAt,
      i.parents,
      i.book.cycles,
    ]),
  );
  const [resolved, setResolved] = useState(new Map<number, Work>());
  const [failed, setFailed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(6);
  useEffect(() => {
    let active = true;
    setResolved(new Map());
    setFailed(0);
    const pending = items.filter(
      (i) =>
        !i.book.isGroup &&
        ((i.book.cycles === undefined && !cleanCycleRefs(i.parents).length) ||
          cleanCycleRefs(i.parents).some((r) => r.name.startsWith("Цикл №"))),
    );
    setLoading(pending.length > 0);
    void pool(pending, 4, async (item) => {
      if (!active) return;
      try {
        const w = await api<Work>("work", { id: item.book.id });
        if (active) setResolved((prev) => new Map(prev).set(w.id, w));
      } catch {
        if (active) setFailed((n) => n + 1);
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [key, retry]);
  const seeds = buildSeeds(library, resolved);
  const found = filterSeeds(seeds, query);
  const selected =
    seeds.find((s) => s.id === selectedId) ??
    seeds.find((s) => s.memberIds.includes(selectedId ?? 0)) ??
    seeds[0];
  useEffect(() => {
    if (selected && selected.id !== selectedId) onSelect(selected.id);
  }, [selected?.id, selectedId, onSelect]);
  return (
    <div className="seed-picker">
      <label className="seed-label" htmlFor="seed-search">
        Книга или цикл из вашей библиотеки
      </label>
      <div className="seed-search">
        <Search size={18} />
        <input
          id="seed-search"
          placeholder="Найти книгу или цикл"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(6);
          }}
          type="search"
        />
      </div>
      <p className="seed-help">
        Здесь книги со статусом «Читаю» или «Прочитано». Книги одного цикла
        объединены. Отдельные произведения показаны отдельно. Можно искать и по
        названиям книг внутри цикла.
      </p>
      {loading && (
        <p className="filter-progress" role="status">
          Уточняем циклы для сохранённых книг…
        </p>
      )}
      {failed > 0 && (
        <div className="filter-failure">
          <p>
            Не для всех книг удалось уточнить цикл. Пока они показаны отдельно.
          </p>
          <button
            className="text-button"
            onClick={() => setRetry((n) => n + 1)}
          >
            Повторить
          </button>
        </div>
      )}
      <div className="seed-list" role="group" aria-label="Основа рекомендаций">
        {found.slice(0, shown).map((s) => (
          <button
            key={s.id}
            className={`seed-option ${selected?.id === s.id ? "active" : ""}`}
            onClick={() => onSelect(s.id)}
            aria-pressed={selected?.id === s.id}
          >
            <span className="seed-icon">
              {s.isGroup ? <LibraryIcon size={19} /> : <BookOpen size={19} />}
            </span>
            <span className="seed-name">
              <strong>{s.name}</strong>
              <small>
                {s.isGroup ? "Цикл" : "Произведение"}
                {s.isGroup ? ` · книг в библиотеке: ${s.members.length}` : ""}
                {s.priority ? " · сейчас читаете" : ""}
              </small>
            </span>
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
      {!found.length && (
        <p className="muted-block">
          В библиотеке нет подходящих книг или циклов. Попробуйте другое
          название.
        </p>
      )}
      {found.length > shown && (
        <button className="text-button" onClick={() => setShown((n) => n + 6)}>
          Показать ещё · осталось {found.length - shown}
        </button>
      )}
      {selected && (
        <div className="selected-seed">
          <span>
            {selected.isGroup ? "На основе цикла" : "На основе произведения"}
          </span>
          <strong>{selected.name}</strong>
        </div>
      )}
    </div>
  );
}
