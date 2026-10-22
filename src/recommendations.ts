import type { Book, Work, Library, LibraryItem, CycleRef } from "./types";
import { cleanCycleRefs, cycleRefs, continuation, sequence } from "./data";
export function activeItems(library: Library) {
  return Object.values(library)
    .filter((i) => i.status === "reading" || i.status === "read")
    .sort(
      (a, b) =>
        Number(b.status === "reading") - Number(a.status === "reading") ||
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
        a.book.id - b.book.id,
    );
}
export async function pool<T, R>(
  items: T[],
  limit: number,
  load: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await load(items[index]);
      }
    }),
  );
  return results;
}
export interface Suggestion {
  book: Book;
  cycle: Work;
  gap: boolean;
  anchor: Book | undefined;
  priority: boolean;
  basis: Book[];
}
export async function continuations(
  library: Library,
  load: (id: number) => Promise<Work>,
) {
  const recent = activeItems(library)
    .filter((i) => !i.book.isGroup || i.status === "reading")
    .slice(0, 12);
  const errors: string[] = [];
  const sources = await pool(recent, 4, async (item) => {
    try {
      if (item.book.isGroup)
        return {
          item,
          refs: [
            { id: item.book.id, name: item.book.name, kind: item.book.kind },
          ],
        };
      const saved = cleanCycleRefs([
        ...item.parents,
        ...(item.book.cycles ?? []),
      ]);
      const refs = saved.length
        ? saved
        : item.book.cycles !== undefined
          ? []
          : cycleRefs(await load(item.book.id));
      return { item, refs };
    } catch {
      errors.push(`Не удалось проверить циклы книги «${item.book.name}».`);
      return { item, refs: [] };
    }
  });
  const refs = new Map<number, { ref: CycleRef; sources: LibraryItem[] }>();
  for (const source of sources)
    for (const ref of source.refs) {
      const row = refs.get(ref.id);
      if (row) row.sources.push(source.item);
      else refs.set(ref.id, { ref, sources: [source.item] });
    }
  const results = await pool([...refs.values()].slice(0, 8), 4, async (row) => {
    try {
      const cycle = await load(row.ref.id);
      if (!cycle.isGroup) return undefined;
      const ordered = sequence(cycle.children);
      const basis = ordered.filter((b) =>
        ["reading", "read"].includes(library[b.id]?.status),
      );
      const readingGroup = row.sources.some(
        (i) => i.book.isGroup && i.status === "reading",
      );
      if (!basis.length && !readingGroup) return undefined;
      const result = continuation(cycle.children, library);
      if (!result.book) return undefined;
      return {
        book: result.book,
        cycle,
        gap: result.gap,
        anchor: result.anchor,
        priority: !!result.anchor || readingGroup,
        basis,
      } satisfies Suggestion;
    } catch {
      errors.push(
        `Не удалось загрузить цикл «${row.ref.name || `№${row.ref.id}`}» для книги «${row.sources[0].book.name}».`,
      );
      return undefined;
    }
  });
  const seen = new Set<number>();
  const suggestions = results
    .filter((s): s is Suggestion => !!s)
    .sort((a, b) => Number(b.priority) - Number(a.priority))
    .filter((s) => {
      if (seen.has(s.book.id)) return false;
      seen.add(s.book.id);
      return true;
    });
  return { suggestions, errors: [...new Set(errors)], checked: recent.length };
}
export interface Seed {
  id: number;
  name: string;
  isGroup: boolean;
  members: string[];
  memberIds: number[];
  priority: boolean;
}
export function buildSeeds(
  library: Library,
  resolved: Map<number, Work> = new Map(),
): Seed[] {
  const seeds = new Map<number, Seed>();
  for (const item of activeItems(library)) {
    const work = resolved.get(item.book.id);
    const refs = work
      ? cycleRefs(work)
      : cleanCycleRefs([...item.parents, ...(item.book.cycles ?? [])]);
    const root = !item.book.isGroup ? refs[0] : undefined;
    const id = root?.id ?? item.book.id;
    const existing = seeds.get(id);
    if (existing) {
      existing.members.push(item.book.name);
      existing.memberIds.push(item.book.id);
      continue;
    }
    seeds.set(id, {
      id,
      name: root?.name || item.book.name,
      isGroup: !!root || item.book.isGroup,
      members: [item.book.name],
      memberIds: [item.book.id],
      priority: item.status === "reading",
    });
  }
  return [...seeds.values()];
}
export function filterSeeds(seeds: Seed[], query: string) {
  const q = query.toLocaleLowerCase("ru").replace(/ё/g, "е").trim();
  return seeds.filter((s) =>
    [s.name, ...s.members].some((n) =>
      n.toLocaleLowerCase("ru").replace(/ё/g, "е").includes(q),
    ),
  );
}
