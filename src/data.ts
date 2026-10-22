import type {
  Book,
  Work,
  Library,
  LibraryItem,
  Status,
  CycleRef,
} from "./types";
export const STORAGE_KEY = "book-compass-library-v1";
const memo = new Map<string, { at: number; value: unknown }>();
const requests = new Map<string, Promise<any>>();
export async function api<T>(
  action: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const query = new URLSearchParams({
    action,
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ),
  });
  const key = query.toString();
  const cached = memo.get(key);
  if (cached && Date.now() - cached.at < 300000) return cached.value as T;
  if (requests.has(key)) return requests.get(key);
  const task = (async () => {
    try {
      const r = await fetch(`/api/fantlab?${query}`, {
        signal: AbortSignal.timeout(45000),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Не удалось загрузить данные.");
      memo.set(key, { at: Date.now(), value: data });
      return data;
    } catch (e) {
      if (e instanceof Error && e.name === "TimeoutError")
        throw new Error(
          "ФантЛаб отвечает дольше обычного. Попробуйте ещё раз.",
        );
      if (e instanceof TypeError)
        throw new Error(
          "Нет соединения. Ваша библиотека доступна на этом устройстве.",
        );
      throw e;
    }
  })();
  requests.set(key, task);
  try {
    return await task;
  } finally {
    requests.delete(key);
  }
}
export function sequence(children: Book[]): Book[] {
  const seen = new Set<number>();
  const result: Book[] = [];
  let contentDepth: number | undefined;
  for (const item of children) {
    if (contentDepth !== undefined && item.depth > contentDepth) continue;
    contentDepth = undefined;
    if (item.isGroup) continue;
    contentDepth = item.depth;
    if (item.published && !seen.has(item.id)) {
      seen.add(item.id);
      result.push(item);
    }
  }
  return result;
}
export function cleanCycleRefs(value: unknown): CycleRef[] {
  if (!Array.isArray(value)) return [];
  const result = new Map<number, CycleRef>();
  for (const ref of value) {
    if (!ref || !Number.isSafeInteger(Number(ref.id)) || Number(ref.id) <= 0)
      continue;
    const id = Number(ref.id);
    const name = typeof ref.name === "string" ? ref.name.trim() : "";
    const previous = result.get(id);
    if (!previous || name)
      result.set(id, {
        id,
        name: name || previous?.name || `Цикл №${id}`,
        kind: typeof ref.kind === "string" ? ref.kind : "",
      });
  }
  return [...result.values()];
}
export function continuation(
  children: Book[],
  library: Library,
): { book?: Book; anchor?: Book; gap: boolean } {
  const ordered = sequence(children);
  const reading = ordered
    .filter((b) => library[b.id]?.status === "reading")
    .sort(
      (a, b) =>
        Date.parse(library[b.id].updatedAt) -
        Date.parse(library[a.id].updatedAt),
    );
  const anchor = reading[0];
  const start = anchor ? ordered.findIndex((b) => b.id === anchor.id) + 1 : 0;
  const next = ordered
    .slice(start)
    .find((b) => !["read", "reading"].includes(library[b.id]?.status));
  const position = next ? ordered.findIndex((b) => b.id === next.id) : -1;
  return {
    book: next,
    anchor,
    gap:
      !anchor &&
      position >= 0 &&
      ordered.slice(position + 1).some((b) => library[b.id]?.status === "read"),
  };
}
export function nextBook(children: Book[], library: Library): Book | undefined {
  return continuation(children, library).book;
}
export function cycleRefs(work: Work): CycleRef[] {
  return cleanCycleRefs([
    ...(work.parents ?? []).map((chain) => chain[0]).filter(Boolean),
    ...(work.roots ?? []),
  ]);
}
export type VolumeGrade = "all" | "short" | "medium" | "long" | "unknown";
export function matchesFilters(
  book: Book,
  type: string,
  genreId: number,
  grade: VolumeGrade,
) {
  if (
    (type === "cycles" && !book.isGroup) ||
    (type === "single" && book.isGroup)
  )
    return false;
  if (genreId && !book.genres?.some((g) => g.id === genreId)) return false;
  const pages = book.volume?.pages;
  return (
    grade === "all" ||
    (grade === "unknown" && !pages) ||
    (grade === "short" && !!pages && pages <= 250) ||
    (grade === "medium" && !!pages && pages > 250 && pages <= 500) ||
    (grade === "long" && !!pages && pages > 500)
  );
}
function safeText(value: unknown, max = 500) {
  return typeof value === "string" ? value.slice(0, max) : "";
}
function safeImage(value: unknown) {
  try {
    const u = new URL(String(value));
    return u.protocol === "https:" &&
      ["fantlab.ru", "www.fantlab.ru", "api.fantlab.ru"].includes(u.hostname)
      ? u.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function validateImport(data: unknown): Library {
  const d = data as { version?: number; items?: unknown[] };
  if (!d || d.version !== 1 || !Array.isArray(d.items) || d.items.length > 5000)
    throw new Error(
      "Нужен JSON-файл экспорта «Книжного компаса» версии 1 (до 5000 книг).",
    );
  const result: Library = {};
  for (const value of d.items) {
    const item = value as LibraryItem;
    const b = item?.book;
    if (
      !b ||
      !Number.isSafeInteger(b.id) ||
      b.id <= 0 ||
      typeof b.name !== "string" ||
      !b.name.trim() ||
      !["unread", "reading", "read", "want"].includes(item.status) ||
      !Array.isArray(b.authors)
    )
      throw new Error(
        "В файле есть некорректные записи. Библиотека не изменена.",
      );
    const authors = b.authors
      .slice(0, 20)
      .map((a) => ({ id: Number(a.id) || 0, name: safeText(a.name) }));
    result[b.id] = {
      book: {
        id: b.id,
        name: safeText(b.name),
        authors,
        image: safeImage(b.image),
        description: safeText(b.description, 20000),
        rating:
          Number(b.rating) > 0 && Number(b.rating) <= 10
            ? Number(b.rating)
            : undefined,
        voters: Number(b.voters) || undefined,
        year: Number(b.year) || undefined,
        kind: safeText(b.kind),
        isGroup: b.isGroup === true,
        published: b.published !== false,
        depth: Math.max(1, Number(b.depth) || 1),
        cycles: Array.isArray(b.cycles) ? cleanCycleRefs(b.cycles) : undefined,
        genres: Array.isArray(b.genres)
          ? b.genres
              .filter(
                (g) =>
                  g &&
                  Number.isSafeInteger(g.id) &&
                  g.id > 0 &&
                  typeof g.name === "string",
              )
              .map((g) => ({ id: g.id, name: safeText(g.name) }))
          : undefined,
        volume:
          b.volume &&
          Number.isSafeInteger(b.volume.pages) &&
          b.volume.pages > 0 &&
          Number.isSafeInteger(b.volume.editionId) &&
          b.volume.editionId > 0
            ? {
                pages: b.volume.pages,
                editionId: b.volume.editionId,
                editionName: safeText(b.volume.editionName),
              }
            : undefined,
      },
      status: item.status as Status,
      parents: cleanCycleRefs(item.parents).slice(0, 30),
      updatedAt:
        typeof item.updatedAt === "string" &&
        !Number.isNaN(Date.parse(item.updatedAt))
          ? item.updatedAt
          : new Date().toISOString(),
    };
  }
  return result;
}
export function readLibrary(): { library: Library; error?: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { library: {} };
    const library = validateImport(JSON.parse(raw));
    return { library };
  } catch {
    return {
      library: {},
      error:
        "Не удалось прочитать библиотеку. Данные не перезаписаны. Попробуйте импортировать резервную копию.",
    };
  }
}
export function serialize(library: Library) {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      items: Object.values(library),
    },
    null,
    2,
  );
}
