import { STORAGE_KEY, serialize, validateImport } from "./data";
import type { Library } from "./types";

export const BACKUP_KEY = `${STORAGE_KEY}-backup`;
export const RECOVERY_KEY = `${STORAGE_KEY}-recovery`;
export interface LibraryRead {
  library: Library;
  error?: string;
  warning?: string;
  raw?: string;
  needsArchive?: boolean;
}
const damaged = "Сохранённую библиотеку не удалось распознать. Исходные данные сохранены без изменений. Не очищайте данные сайта.";

/** Local recovery is separate from strict, atomic JSON-file import validation. */
export function decodeStoredLibrary(raw: string): LibraryRead {
  try {
    let value = JSON.parse(raw);
    // Accept previously double-encoded JSON without changing its contents on disk.
    if (typeof value === "string") value = JSON.parse(value);
    let entries: unknown[];
    if (Array.isArray(value)) entries = value;
    else if (value && value.version === 1 && Array.isArray(value.items)) entries = value.items;
    else if (value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).every((key) => /^\d+$/.test(key))) entries = Object.values(value);
    else return { library: {}, error: damaged, raw };

    const library: Library = {};
    let skipped = 0;
    let repaired = false;
    for (const entry of entries) {
      try {
        if (!entry || typeof entry !== "object") throw new Error();
        const item = entry as Record<string, any>;
        if (!item.book || typeof item.book !== "object") throw new Error();
        const book = {
          ...item.book,
          id: Number(item.book.id),
          authors: Array.isArray(item.book.authors) ? item.book.authors : [],
        };
        const normalized = validateImport({ version: 1, items: [{ ...item, book }] });
        Object.assign(library, normalized);
        if (book.id !== item.book.id || !Array.isArray(item.book.authors) ||
          item.book.authors.some((a: unknown) => !a || typeof a !== "object")) repaired = true;
      } catch { skipped++; }
    }
    const count = Object.keys(library).length;
    if (entries.length && !count) return { library: {}, error: damaged, raw };
    return {
      library, raw,
      needsArchive: repaired || skipped > 0 || !value || value.version !== 1,
      warning: skipped
        ? `Восстановлено книг: ${count}. Не удалось прочитать записей: ${skipped}. Исходные данные сохранены; остальные книги доступны.`
        : repaired || value.version !== 1
          ? `Библиотека восстановлена: ${count} книг. Исходные данные сохранены.`
          : undefined,
    };
  } catch { return { library: {}, error: damaged, raw }; }
}

/** Reading never writes, including React StrictMode's repeated initialization. */
export function readLibrary(storage?: Pick<Storage, "getItem">): LibraryRead {
  try {
    const store = storage ?? window.localStorage;
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return { library: {} };
    const current = decodeStoredLibrary(raw);
    if (!current.error) return current;
    const backup = store.getItem(BACKUP_KEY);
    if (backup) {
      const restored = decodeStoredLibrary(backup);
      if (!restored.error) return {
        ...restored, raw, needsArchive: true,
        warning: "Библиотека восстановлена из автоматической копии на этом устройстве. Последние изменения могли не войти в неё. Исходные данные сохранены.",
      };
    }
    return current;
  } catch {
    return { library: {}, error: "Chrome или другой браузер запретил доступ к памяти сайта. Книги не удалены приложением. Разрешите хранение данных сайта и нажмите «Попробовать ещё раз»." };
  }
}

/** Preserve the source before replacing any repaired data; block unreadable data. */
export function writeLibrary(library: Library, storage?: Pick<Storage, "getItem" | "setItem">, allowRecovery = false): void {
  const store = storage ?? window.localStorage;
  const current = readLibrary(store);
  if (current.error && (!allowRecovery || current.raw === undefined))
    throw new Error(current.error + " Изменение не сохранено.");
  const next = serialize(library);
  const checked = decodeStoredLibrary(next);
  if (checked.error || checked.needsArchive) throw new Error("Изменение не сохранено: проверьте данные книги.");
  if (current.raw) {
    if (current.needsArchive || current.error) {
      const previous = store.getItem(RECOVERY_KEY);
      const key = previous && previous !== current.raw ? `${RECOVERY_KEY}-${Date.now()}` : RECOVERY_KEY;
      store.setItem(key, current.raw);
    } else store.setItem(BACKUP_KEY, current.raw);
  } else store.setItem(BACKUP_KEY, next);
  store.setItem(STORAGE_KEY, next);
}
