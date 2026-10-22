import type { Book, Work, CycleRef, Author, Genre, Volume } from "../src/types";
type Raw = Record<string, any>;
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}
const cache = new Map<string, { expires: number; value: any }>();
const pending = new Map<string, Promise<any>>();
async function upstream(path: string, ttl = 3600000): Promise<any> {
  const hit = cache.get(path);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (pending.has(path)) return pending.get(path);
  const request = (async () => {
    try {
      const r = await fetch(`https://api.fantlab.ru${path}`, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "BookCompass/1.0 (https://github.com/Belowskij/book-compass-fantlab)",
        },
        signal: AbortSignal.timeout(18000),
      });
      if (!r.ok)
        throw new ApiError(
          r.status === 404
            ? "ФантЛаб не нашёл эту страницу."
            : "ФантЛаб временно не отвечает. Попробуйте ещё раз.",
          r.status === 404 ? 404 : 502,
        );
      const data = await r.json();
      if (data?.error)
        throw new ApiError(
          "Не удалось получить данные ФантЛаба. Попробуйте другой запрос.",
        );
      if (cache.size >= 200) cache.delete(cache.keys().next().value!);
      cache.set(path, { value: data, expires: Date.now() + ttl });
      return data;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(
        "Не удалось связаться с ФантЛабом. Проверьте соединение и повторите попытку.",
        503,
      );
    }
  })();
  pending.set(path, request);
  try {
    return await request;
  } finally {
    pending.delete(path);
  }
}
export function plain(value: unknown): string {
  return String(value ?? "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\[\/?[^\]]+\]/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}
function imageUrl(value: unknown) {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const u = new URL(value, "https://fantlab.ru");
    if (
      !["fantlab.ru", "api.fantlab.ru", "www.fantlab.ru"].includes(u.hostname)
    )
      return undefined;
    u.protocol = "https:";
    return u.href;
  } catch {
    return undefined;
  }
}
function number(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
export function book(raw: Raw): Book {
  const kind = plain(
    raw.work_type ?? raw.name_type ?? raw.name_show_im ?? "Произведение",
  );
  return {
    cycles: raw.saga?.id
      ? [
          {
            id: Number(raw.saga.id),
            name: plain(raw.saga.name),
            kind: plain(raw.saga.name_type),
          },
        ]
      : undefined,
    id: Number(raw.work_id ?? raw.id),
    name: plain(
      raw.work_name ||
        raw.rusname ||
        raw.name ||
        raw.fullname ||
        "Без названия",
    ),
    authors: (raw.authors ?? raw.creators?.authors ?? []).map((a: Raw) => ({
      id: Number(a.id),
      name: plain(a.name),
    })),
    image: imageUrl(raw.image),
    description: plain(raw.work_description ?? raw.description),
    rating: number(raw.rating?.rating ?? raw.stat?.rating),
    voters: number(raw.rating?.voters ?? raw.stat?.voters),
    year: number(raw.work_year ?? raw.year),
    kind,
    isGroup:
      raw.work_type_icon === "cycle" ||
      raw.name_type_icon === "cycle" ||
      /цикл|эпопея/.test(kind.toLowerCase()),
    published: Number(raw.work_published ?? raw.published ?? 1) === 1,
    depth: Number(raw.deep ?? raw.position_level ?? 1),
    note: plain(raw.bonus_text ?? raw.work_name_bonus),
  };
}
export function refs(rows: unknown): CycleRef[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (r) =>
        r && Number.isSafeInteger(Number(r.work_id)) && Number(r.work_id) > 0,
    )
    .map((r) => ({
      id: Number(r.work_id),
      name: plain(r.work_name) || `Цикл №${r.work_id}`,
      kind: plain(r.work_type),
    }));
}
export function genres(raw: Raw): Genre[] {
  const group = raw.classificatory?.genre_group?.find(
    (g: Raw) => Number(g.genre_group_id) === 1,
  );
  const result = new Map<number, Genre>();
  function visit(rows: Raw[] = []) {
    for (const g of rows) {
      if (number(g.genre_id) && plain(g.label) && Number(g.votes) > 0)
        result.set(Number(g.genre_id), {
          id: Number(g.genre_id),
          name: plain(g.label),
        });
      if (Array.isArray(g.genre)) visit(g.genre);
    }
  }
  visit(group?.genre);
  return [...result.values()];
}
export function volume(raw: Raw): Volume | undefined {
  if (book(raw).isGroup) return undefined;
  const normalize = (s: unknown) =>
    plain(s)
      .toLocaleLowerCase("ru")
      .replace(/ё/g, "е")
      .replace(/[^а-яa-z0-9]/g, "");
  const names = new Set(
    [raw.work_name, ...(raw.work_name_alts ?? [])]
      .map(normalize)
      .filter(Boolean),
  );
  const editions = (Object.values(raw.editions_blocks ?? {}) as Raw[])
    .filter((b) => b.block === "paper")
    .flatMap((b) => b.list ?? []);
  const edition = editions.find(
    (e: Raw) =>
      e.lang_code === "ru" &&
      Number(e.type) === 10 &&
      names.has(normalize(e.name)) &&
      number(e.pages) &&
      number(e.edition_id),
  );
  return edition
    ? {
        pages: Number(edition.pages),
        editionId: Number(edition.edition_id),
        editionName: plain(edition.name),
      }
    : undefined;
}
export async function getWork(id: number): Promise<Work> {
  const r = await upstream(`/work/${id}/extended`);
  const parents = (Array.isArray(r.parents?.cycles) ? r.parents.cycles : [])
    .map(refs)
    .filter((c: CycleRef[]) => c.length);
  const roots = refs(r.work_root_saga);
  return {
    ...book(r),
    parents,
    roots,
    cycles: [
      ...new Map(
        [...parents.map((c: CycleRef[]) => c[0]), ...roots].map((c) => [
          c.id,
          c,
        ]),
      ).values(),
    ],
    children: (r.children ?? []).map(book),
    notes: plain(r.work_notes),
    genres: genres(r),
    volume: volume(r),
  };
}
async function minis(ids: number[], type = "w") {
  if (!ids.length) return [];
  const r = await upstream(`/search-ids?${type}=${ids.join(",")}`);
  return r[type === "w" ? "works" : "authors"] ?? [];
}
export async function handle(url: URL) {
  const action = url.searchParams.get("action");
  const id = Number(url.searchParams.get("id"));
  if (
    ["work", "author", "similar"].includes(action ?? "") &&
    (!Number.isSafeInteger(id) || id < 1 || id > 100000000)
  )
    throw new ApiError("Некорректный номер карточки.", 400);
  if (action === "work") return getWork(id);
  if (action === "similar") {
    const r = await upstream(`/work/${id}/similars`);
    const list = Array.isArray(r) ? r : r.works;
    if (!Array.isArray(list))
      throw new ApiError(
        "ФантЛаб вернул неизвестный формат похожих произведений.",
      );
    return { books: list.map(book) };
  }
  if (action === "author") {
    const r = await upstream(`/autor/${id}/extended`);
    const result: Author = {
      id: Number(r.autor_id ?? r.id),
      name: plain(r.name),
      image: imageUrl(r.image),
      description: plain(r.anons ?? r.biography),
      books: [],
    };
    const seen = new Set<number>();
    for (const blocks of [r.cycles_blocks, r.works_blocks])
      for (const block of Object.values(blocks ?? {}) as Raw[])
        for (const item of block.list ?? []) {
          const b = book(item);
          if (!seen.has(b.id)) {
            seen.add(b.id);
            result.books!.push(b);
          }
        }
    return result;
  }
  if (action === "featured") {
    return { books: (await minis([4325, 1, 7, 2797])).map(book) };
  }
  if (action === "search") {
    const q = (url.searchParams.get("q") ?? "").trim();
    const kind =
      url.searchParams.get("kind") === "authors" ? "authors" : "works";
    const page = Number(url.searchParams.get("page") ?? 1);
    if (
      q.length < 2 ||
      q.length > 120 ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 40
    )
      throw new ApiError("Введите от 2 до 120 символов для поиска.", 400);
    const r = await upstream(
      `/search-${kind === "authors" ? "autors" : "works"}?${new URLSearchParams({ q, page: String(page) })}`,
      300000,
    );
    const matches = r.matches ?? [];
    const ids = matches.map((m: Raw) =>
      Number(kind === "authors" ? m.autor_id : m.work_id),
    );
    let cards: Raw[] = [];
    let warning: string | undefined;
    try {
      cards = await minis(ids, kind === "authors" ? "a" : "w");
    } catch {
      warning = "Не удалось загрузить обложки. Названия доступны.";
    }
    const byId = new Map(cards.map((c) => [Number(c.id), c]));
    return {
      total: Number(r.total ?? matches.length),
      page,
      warning,
      books:
        kind === "works"
          ? matches.map((m: Raw) => {
              const mini = byId.get(Number(m.work_id));
              if (mini) return book(mini);
              return {
                ...book(m),
                authors: [
                  {
                    id: Number(m.autor1_id),
                    name: plain(m.all_autor_rusname || m.autor1_rusname),
                  },
                ],
              };
            })
          : [],
      authors:
        kind === "authors"
          ? matches.map((m: Raw) => ({
              id: Number(m.autor_id),
              name: plain(m.rusname || m.name),
              image: imageUrl(byId.get(Number(m.autor_id))?.image),
              description: plain(m.country),
            }))
          : [],
    };
  }
  throw new ApiError("Такой запрос не поддерживается.", 400);
}
export async function response(url: URL) {
  try {
    return { status: 200, body: await handle(url) };
  } catch (e) {
    const error =
      e instanceof ApiError
        ? e
        : new ApiError(
            "Не удалось обработать ответ ФантЛаба. Попробуйте позже.",
          );
    return { status: error.status, body: { error: error.message } };
  }
}
