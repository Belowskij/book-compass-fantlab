import type { Book, CycleRef, Library, Work } from "./types";
import { cleanCycleRefs, cycleRefs } from "./data";
import { expandCycle } from "./library";
import { pool } from "./recommendations";

export interface CycleProgress {
  cycle: Work;
  books: Book[];
}
export async function loadCycleProgress(
  library: Library,
  load: (id: number) => Promise<Work>,
) {
  const items = Object.values(library).sort(
    (a, b) =>
      Number(b.status === "reading") - Number(a.status === "reading") ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
  const refs = new Map<number, CycleRef>();
  const errors: string[] = [];
  await pool(items.slice(0, 60), 4, async (item) => {
    try {
      const saved = cleanCycleRefs([
        ...item.parents,
        ...(item.book.cycles ?? []),
      ]);
      const found = item.book.isGroup
        ? [{ id: item.book.id, name: item.book.name, kind: item.book.kind }]
        : saved.length
          ? saved
          : item.book.cycles !== undefined
            ? []
            : cycleRefs(await load(item.book.id));
      // One root per work keeps nested cycles from multiplying progress cards.
      if (found[0]) refs.set(found[0].id, found[0]);
    } catch {
      errors.push(`Не удалось определить цикл «${item.book.name}».`);
    }
  });
  const rows = await pool([...refs.values()].slice(0, 20), 4, async (ref) => {
    try {
      const expanded = await expandCycle(await load(ref.id), load);
      return {
        cycle: expanded.work,
        books: expanded.books,
      } satisfies CycleProgress;
    } catch {
      errors.push(`Не удалось загрузить состав цикла «${ref.name}».`);
      return undefined;
    }
  });
  return {
    rows: rows.filter((r): r is CycleProgress => !!r),
    errors,
    limited: items.length > 60 || refs.size > 20,
  };
}
