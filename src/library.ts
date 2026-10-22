import type { Book, Library, Work } from "./types";
import { cycleRefs, sequence } from "./data";

/** A subtree in FantLab's flat, bibliography-ordered children array. */
export function descendants(rows: Book[], index: number): Book[] {
  const depth = rows[index].depth;
  let end = index + 1;
  while (end < rows.length && rows[end].depth > depth) end++;
  return rows.slice(index + 1, end);
}

export function isCycleRead(rows: Book[], library: Library): boolean {
  const books = sequence(rows);
  // A group without inline contents may still need a separate API request.
  const complete = rows.every(
    (b, i) => !b.isGroup || !b.published || descendants(rows, i).length > 0,
  );
  return (
    complete &&
    books.length > 0 &&
    books.every((b) => library[b.id]?.status === "read")
  );
}

export interface ExpandedCycle {
  work: Work;
  books: Book[];
  groupIds: number[];
}

/** Fetch missing subcycles before changing any library records. */
export async function expandCycle(
  selected: Book | Work,
  load: (id: number) => Promise<Work>,
): Promise<ExpandedCycle> {
  const work =
    "children" in selected ? (selected as Work) : await load(selected.id);
  if (!work.isGroup || work.id !== selected.id)
    throw new Error(
      "Не удалось подтвердить состав цикла. Библиотека не изменена.",
    );
  const groups = new Set<number>([work.id]);
  const books = new Map<number, Book>();
  let requests = 0;
  async function visit(rows: Book[], level: number): Promise<void> {
    if (level > 20)
      throw new Error(
        "Слишком большая вложенность цикла. Библиотека не изменена.",
      );
    for (let i = 0; i < rows.length; i++) {
      const b = rows[i];
      const nested = descendants(rows, i);
      if (b.isGroup) {
        if (!groups.has(b.id)) {
          groups.add(b.id);
          if (nested.length) await visit(nested, level + 1);
          else if (b.published) {
            if (++requests > 100)
              throw new Error(
                "Этот цикл слишком велик для одной операции. Отметьте его подциклы отдельно.",
              );
            const child = await load(b.id);
            if (child.id !== b.id || !child.isGroup)
              throw new Error(
                "Не удалось подтвердить состав подцикла. Библиотека не изменена.",
              );
            await visit(child.children, level + 1);
          }
        }
      } else if (b.published && b.id !== work.id) {
        books.set(b.id, b);
        if (books.size > 5000)
          throw new Error(
            "В цикле больше 5000 произведений. Отметьте его подциклы отдельно.",
          );
      }
      // A novel's excerpts/chapters are not extra books; a subcycle was visited above.
      i += nested.length;
    }
  }
  await visit(work.children, 0);
  if (!books.size)
    throw new Error(
      "ФантЛаб не вернул опубликованных произведений в составе цикла. Библиотека не изменена.",
    );
  return { work, books: [...books.values()], groupIds: [...groups] };
}

/** Apply to the latest library so concurrent edits and richer book data survive. */
export function markCycleRead(
  library: Library,
  cycle: ExpandedCycle,
  changedAt: string,
): Library {
  const next = { ...library };
  const parents = [
    ...new Map(
      [
        ...cycleRefs(cycle.work),
        { id: cycle.work.id, name: cycle.work.name, kind: cycle.work.kind },
      ].map((ref) => [ref.id, ref]),
    ).values(),
  ];
  for (const id of cycle.groupIds) {
    const item = next[id];
    if (
      item?.book.isGroup &&
      Date.parse(item.updatedAt) <= Date.parse(changedAt)
    )
      delete next[id];
  }
  for (const b of cycle.books) {
    const existing = next[b.id];
    if (existing && Date.parse(existing.updatedAt) > Date.parse(changedAt))
      continue;
    const refs = [
      ...new Map(
        [...parents, ...(existing?.parents ?? [])].map((ref) => [ref.id, ref]),
      ).values(),
    ];
    next[b.id] = {
      book: { ...b, ...existing?.book },
      status: "read",
      parents: refs,
      updatedAt: changedAt,
    };
  }
  return next;
}
