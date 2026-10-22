import type { Book, Library, LibraryItem } from "./types";
import { serialize, validateImport } from "./data";

export interface ReadingList {
  id: string;
  name: string;
  books: Book[];
  updatedAt: string;
}
export interface RemovedBook {
  item: LibraryItem;
  deletedAt: string;
}
export interface Plans {
  lists: ReadingList[];
  removed: RemovedBook[];
  activeId?: string;
}
export const PLANS_KEY = "book-compass-plans-v1";
export const emptyPlans = (): Plans => ({ lists: [], removed: [] });

export function validatePlans(value: unknown): Plans {
  const raw = value as Record<string, any>;
  if (
    !raw ||
    raw.version !== 1 ||
    !Array.isArray(raw.lists) ||
    raw.lists.length > 100 ||
    (raw.removed !== undefined &&
      (!Array.isArray(raw.removed) || raw.removed.length > 50))
  )
    throw new Error(
      "Не удалось прочитать личные очереди. Исходные данные не изменены.",
    );
  const ids = new Set<string>();
  const lists = raw.lists.map((list: any): ReadingList => {
    if (
      !list ||
      typeof list.id !== "string" ||
      !list.id ||
      list.id.length > 100 ||
      ids.has(list.id) ||
      typeof list.name !== "string" ||
      !list.name.trim() ||
      !Array.isArray(list.books) ||
      list.books.length > 1000
    )
      throw new Error("Некорректный список чтения. Данные не изменены.");
    ids.add(list.id);
    const seen = new Set<number>();
    const books = list.books.map((book: Book) => {
      const entry = validateImport({
        version: 1,
        items: [{ book, status: "want", parents: [] }],
      });
      const normalized = Object.values(entry)[0].book;
      if (normalized.isGroup || seen.has(normalized.id))
        throw new Error(
          "В очередь можно добавить отдельные произведения без повторов.",
        );
      seen.add(normalized.id);
      return normalized;
    });
    return {
      id: list.id,
      name: list.name.trim().slice(0, 120),
      books,
      updatedAt:
        typeof list.updatedAt === "string" &&
        !Number.isNaN(Date.parse(list.updatedAt))
          ? list.updatedAt
          : new Date().toISOString(),
    };
  });
  const removed = (raw.removed ?? []).map((row: any) => {
    const item = Object.values(
      validateImport({ version: 1, items: [row?.item] }),
    )[0];
    return {
      item,
      deletedAt:
        typeof row.deletedAt === "string"
          ? row.deletedAt
          : new Date().toISOString(),
    };
  });
  return {
    lists,
    removed,
    activeId: lists.some((l: ReadingList) => l.id === raw.activeId)
      ? raw.activeId
      : undefined,
  };
}
export function readPlans(): { plans: Plans; error?: string } {
  try {
    const raw = window.localStorage.getItem(PLANS_KEY);
    return { plans: raw ? validatePlans(JSON.parse(raw)) : emptyPlans() };
  } catch {
    return {
      plans: emptyPlans(),
      error:
        "Не удалось прочитать личные очереди и удалённые книги. Исходные данные сохранены; изменения этих разделов заблокированы.",
    };
  }
}
export function writePlans(plans: Plans) {
  const store = window.localStorage;
  const previous = store.getItem(PLANS_KEY);
  if (previous) validatePlans(JSON.parse(previous));
  const normalized = validatePlans({ version: 1, ...plans });
  const next = JSON.stringify({ version: 1, ...normalized });
  if (previous) store.setItem(`${PLANS_KEY}-backup`, previous);
  store.setItem(PLANS_KEY, next);
}
export function moveBook(
  list: ReadingList,
  id: number,
  position: number,
): ReadingList {
  const book = list.books.find((b) => b.id === id);
  if (!book) return list;
  const books = list.books.filter((b) => b.id !== id);
  books.splice(Math.max(0, Math.min(books.length, position)), 0, book);
  return { ...list, books, updatedAt: new Date().toISOString() };
}
export function listProgress(list: ReadingList, library: Library) {
  const read = list.books.filter(
    (b) => library[b.id]?.status === "read",
  ).length;
  const current = list.books
    .filter((b) => library[b.id]?.status === "reading")
    .sort((a, b) =>
      library[b.id].updatedAt.localeCompare(library[a.id].updatedAt),
    )[0];
  const start = current
    ? list.books.findIndex((b) => b.id === current.id) + 1
    : 0;
  const next = list.books
    .slice(start)
    .find((b) => !["read", "reading"].includes(library[b.id]?.status));
  return { read, total: list.books.length, current, next };
}
export function serializeWorkspace(library: Library, plans: Plans) {
  return JSON.stringify(
    {
      ...JSON.parse(serialize(library)),
      readingLists: plans.lists,
      activeListId: plans.activeId,
      removedBooks: plans.removed,
    },
    null,
    2,
  );
}
export function importPlans(data: Record<string, unknown>): Plans | undefined {
  if (data.readingLists === undefined && data.removedBooks === undefined)
    return undefined;
  return validatePlans({
    version: 1,
    lists: data.readingLists ?? [],
    removed: data.removedBooks ?? [],
    activeId: data.activeListId,
  });
}
