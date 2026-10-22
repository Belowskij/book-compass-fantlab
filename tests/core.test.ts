import { test } from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/hyperion.json";
import { book, response } from "../server/fantlab";
import { nextBook, sequence, serialize, validateImport } from "../src/data";
import type { Library } from "../src/types";
const children = fixture.children.map(book);
const read = (ids: number[]): Library =>
  Object.fromEntries(
    ids.map((id) => [
      id,
      {
        book: children.find((b) => b.id === id)!,
        status: "read",
        parents: [],
        updatedAt: "2026-10-22T00:00:00Z",
      },
    ]),
  );
test("real Hyperion bibliography: preserve nested blocks and story, never sort by year", () => {
  assert.deepEqual(
    sequence(children).map((b) => b.id),
    [1, 2, 3, 4, 644],
  );
  assert.deepEqual(
    sequence(children.map((b, i) => ({ ...b, year: 2100 - i }))).map(
      (b) => b.id,
    ),
    [1, 2, 3, 4, 644],
  );
  assert.equal(nextBook(children, read([1, 2]))?.name, "Эндимион");
  assert.equal(nextBook(children, read([1, 2, 3, 4]))?.id, 644);
  assert.equal(nextBook(children, read([1, 2, 3, 4, 644])), undefined);
});
test("fill unread gaps and skip unpublished works and nested excerpts", () => {
  assert.equal(nextBook(children, read([1, 3]))?.id, 2);
  const excerpt = { ...children[1], id: 417763, depth: 3, kind: "отрывок" };
  assert.ok(
    !sequence([...children.slice(0, 2), excerpt, ...children.slice(2)]).some(
      (b) => b.id === excerpt.id,
    ),
  );
  assert.equal(
    nextBook(
      children.map((b) => (b.id === 2 ? { ...b, published: false } : b)),
      read([1]),
    )?.id,
    3,
  );
});
test("library JSON round trip retains statuses and metadata", () => {
  const source = read([1, 2]);
  const restored = validateImport(JSON.parse(serialize(source)));
  assert.equal(restored[1].status, "read");
  assert.equal(restored[2].book.name, "Падение Гипериона");
  assert.equal(restored[1].updatedAt, source[1].updatedAt);
});
test("invalid imports fail atomically; untrusted images are discarded", () => {
  assert.throws(() => validateImport({ version: 2, items: [] }));
  assert.throws(() =>
    validateImport({
      version: 1,
      items: [
        { book: { id: 1, name: "Гиперион", authors: [] }, status: "broken" },
      ],
    }),
  );
  const item = read([1])["1"];
  assert.equal(
    validateImport({
      version: 1,
      items: [
        { ...item, book: { ...item.book, image: "javascript:alert(1)" } },
      ],
    })[1].book.image,
    undefined,
  );
});
test("proxy rejects invalid operations and identifiers before upstream request", async () => {
  for (const q of [
    "action=work&id=-1",
    "action=work&id=abc",
    "action=search&q=x",
    "action=search&q=Дюна&page=0",
    "action=https://example.com",
  ])
    assert.equal(
      (await response(new URL("https://example.test/?" + q))).status,
      400,
    );
});

import { expandCycle, markCycleRead, isCycleRead } from "../src/library";
import type { Work } from "../src/types";
const cycleWork: Work = {
  ...book(fixture.work),
  children,
  parents: [],
  roots: [],
  notes: "",
};
const neverLoad = async (): Promise<Work> => {
  throw new Error("Inline contents should not cause an API request");
};
test("marking a complete nested cycle expands five published works without cycle records or duplicates", async () => {
  const cycle = await expandCycle(cycleWork, neverLoad);
  assert.deepEqual(
    cycle.books.map((b) => b.id),
    [1, 2, 3, 4, 644],
  );
  assert.deepEqual(cycle.groupIds, [92, 402728, 402730]);
  const unrelated = book(fixture.unrelated);
  const current: Library = {
    92: {
      book: cycleWork,
      status: "read",
      parents: [],
      updatedAt: "2026-10-21T00:00:00Z",
    },
    402728: {
      book: children[0],
      status: "want",
      parents: [],
      updatedAt: "2026-10-21T00:00:00Z",
    },
    4325: {
      book: unrelated,
      status: "reading",
      parents: [],
      updatedAt: "2026-10-21T00:00:00Z",
    },
    ...read([1]),
  };
  current[1].book.image = "https://fantlab.ru/images/editions/big/184";
  const next = markCycleRead(current, cycle, "2026-10-22T00:00:01Z");
  assert.equal(Object.keys(next).length, 6);
  assert.deepEqual(
    Object.values(next)
      .filter((i) => i.status === "read")
      .map((i) => i.book.id),
    [1, 2, 3, 4, 644],
  );
  assert.equal(
    Object.values(next).some((i) => i.book.isGroup),
    false,
  );
  assert.equal(next[1].book.image, current[1].book.image);
  assert.equal(next[4325], current[4325]);
  assert.deepEqual(
    Object.keys(markCycleRead(next, cycle, "2026-10-22T00:00:02Z")),
    Object.keys(next),
  );
  assert.equal(isCycleRead(children, next), true);
  next[2] = { ...next[2], status: "unread" };
  assert.equal(isCycleRead(children, next), false);
});
test("missing subcycles are loaded recursively; failures never produce a partial library update", async () => {
  const sparse: Work = {
    ...cycleWork,
    children: [children[0], children[3], children[6]],
  };
  const requested: number[] = [];
  const expanded = await expandCycle(sparse, async (id) => {
    requested.push(id);
    const group = children.find((b) => b.id === id)!;
    return {
      ...cycleWork,
      ...group,
      children: id === 402728 ? children.slice(1, 3) : children.slice(4, 6),
    };
  });
  assert.deepEqual(requested, [402728, 402730]);
  assert.deepEqual(
    expanded.books.map((b) => b.id),
    [1, 2, 3, 4, 644],
  );
  const current = read([1]);
  const before = JSON.stringify(current);
  await assert.rejects(
    () =>
      expandCycle(sparse, async () => {
        throw new Error("API unavailable");
      }),
    /API unavailable/,
  );
  assert.equal(JSON.stringify(current), before);
  await assert.rejects(
    () => expandCycle({ ...cycleWork, children: [] }, neverLoad),
    /не вернул опубликованных/,
  );
});
test("legacy cycle migration preserves later individual status edits", async () => {
  const cycle = await expandCycle(cycleWork, neverLoad);
  const current = read([2]);
  current[2].status = "want";
  current[2].updatedAt = "2026-10-22T12:00:00Z";
  const next = markCycleRead(current, cycle, "2026-10-22T10:00:00Z");
  assert.equal(next[2], current[2]);
  assert.equal(next[1].status, "read");
  assert.equal(isCycleRead(children, next), false);
});

import metadataFixture from "./fixtures/metadata.json";
import { genres, volume, refs } from "../server/fantlab";
import { cleanCycleRefs, continuation, matchesFilters } from "../src/data";
import { continuations, buildSeeds, filterSeeds } from "../src/recommendations";
test("current reading anchors the next work, skips earlier gaps and already read books", () => {
  const library = read([2]);
  library[3] = { ...read([3])[3], status: "reading" };
  assert.equal(nextBook(children, library)?.id, 4);
  assert.equal(continuation(children, library).anchor?.id, 3);
  library[3].status = "want";
  library[1] = { ...read([1])[1], status: "reading" };
  assert.equal(nextBook(children, library)?.id, 3);
  library[1].status = "read";
  library[644] = { ...read([644])[644], status: "reading" };
  assert.equal(nextBook(children, library), undefined);
});
test("current cycle has priority over a recently updated completed book in another cycle", async () => {
  const lib = read([1]);
  lib[1].parents = [
    { id: 402728, name: "Песни Гипериона", kind: "роман-эпопея" },
  ];
  lib[1].updatedAt = "2026-10-22T23:00:00Z";
  lib[3] = {
    ...read([3])[3],
    status: "reading",
    updatedAt: "2026-10-21T00:00:00Z",
    parents: [{ id: 402730, name: "Песни Эндимиона", kind: "роман-эпопея" }],
  };
  const result = await continuations(lib, async (id) => ({
    ...cycleWork,
    id,
    name: id === 402730 ? "Песни Эндимиона" : "Песни Гипериона",
    children: id === 402730 ? children.slice(4, 6) : children.slice(1, 3),
  }));
  assert.deepEqual(
    result.suggestions.map((s) => s.book.id),
    [4, 2],
  );
  assert.equal(result.suggestions[0].anchor?.id, 3);
  assert.deepEqual(result.errors, []);
});
test("invalid or empty cycle references never become requests to id 0 and errors keep context", async () => {
  assert.deepEqual(
    refs([{ work_id: 0, work_name: "" }, { work_name: "" }, null]),
    [],
  );
  assert.deepEqual(
    cleanCycleRefs([{ id: 0, name: "" }, null, { id: "bad", name: "" }]),
    [],
  );
  const lib = read([1]);
  lib[1].parents = [{ id: 0, name: "", kind: "" }];
  const requests: number[] = [];
  const result = await continuations(lib, async (id) => {
    requests.push(id);
    return {
      ...cycleWork,
      id: 1,
      isGroup: false,
      parents: [],
      roots: [],
      cycles: [],
    };
  });
  assert.deepEqual(requests, [1]);
  assert.deepEqual(result.errors, []);
  lib[1].parents = [{ id: 92, name: "", kind: "цикл" }];
  const failed = await continuations(lib, async () => {
    throw new Error("unavailable");
  });
  assert.match(failed.errors[0], /№92/);
  assert.ok(!failed.errors[0].includes("«»"));
});
test("seed list groups series members once and searches by member title", () => {
  const lib = read([1, 2, 3, 4, 644]);
  for (const item of Object.values(lib))
    item.parents = [{ id: 92, name: "Песни Гипериона", kind: "цикл" }];
  const seeds = buildSeeds(lib);
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].id, 92);
  assert.equal(seeds[0].members.length, 5);
  assert.equal(filterSeeds(seeds, "Эндимион")[0].id, 92);
});
test("real genre taxonomy includes subgenres only; volume belongs to a matching Russian edition", () => {
  const hyperion = metadataFixture[0];
  const g = genres(hyperion);
  assert.ok(g.some((x) => x.name === "Космоопера"));
  assert.ok(!g.some((x) => x.name === "Далёкое будущее"));
  const v = volume(hyperion);
  assert.equal(v?.pages, 672);
  assert.equal(v?.editionId, 184);
  assert.equal(volume({ ...hyperion, work_type_icon: "cycle" }), undefined);
  const b = { ...book(hyperion), genres: g, volume: v };
  assert.equal(matchesFilters(b, "single", 1, "long"), true);
  assert.equal(matchesFilters(b, "cycles", 0, "all"), false);
  assert.equal(matchesFilters(b, "all", 999999, "all"), false);
  assert.equal(matchesFilters(b, "all", 0, "short"), false);
  const restored = validateImport(
    JSON.parse(
      serialize({
        1: {
          book: {
            ...b,
            cycles: [{ id: 92, name: "Песни Гипериона", kind: "цикл" }],
          },
          status: "read",
          parents: [],
          updatedAt: "2026-10-22T00:00:00Z",
        },
      }),
    ),
  );
  assert.equal(restored[1].book.volume?.pages, 672);
  assert.equal(restored[1].book.genres?.length, g.length);
  assert.equal(restored[1].book.cycles?.[0].id, 92);
});
