export interface Person {
  id: number;
  name: string;
}
export interface Genre {
  id: number;
  name: string;
}
export interface Volume {
  pages: number;
  editionId: number;
  editionName: string;
}
export interface Book {
  id: number;
  name: string;
  authors: Person[];
  image?: string;
  description?: string;
  rating?: number;
  voters?: number;
  year?: number;
  kind: string;
  isGroup: boolean;
  published: boolean;
  depth: number;
  note?: string;
  cycles?: CycleRef[];
  genres?: Genre[];
  volume?: Volume;
}
export interface CycleRef {
  id: number;
  name: string;
  kind: string;
}
export interface Work extends Book {
  parents: CycleRef[][];
  roots: CycleRef[];
  children: Book[];
  notes: string;
}
export interface Author {
  id: number;
  name: string;
  image?: string;
  description?: string;
  books?: Book[];
}
export type Status = "unread" | "reading" | "read" | "want";
export interface LibraryItem {
  book: Book;
  status: Status;
  parents: CycleRef[];
  updatedAt: string;
}
export type Library = Record<string, LibraryItem>;
export const statuses: Record<Status, string> = {
  unread: "Не читал",
  reading: "Читаю",
  read: "Прочитано",
  want: "Хочу прочитать",
};
