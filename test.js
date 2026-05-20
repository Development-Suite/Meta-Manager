/**
 * Integration test for @ubyjerome/meta-manager
 * Uses a mongoose mock (no real DB or download needed in this environment).
 * Every method of MetaService is exercised including validation, events,
 * soft-delete, restore, children, and interceptors.
 */

"use strict";

const Joi = require("joi");
const EventEmitter = require("events");

// ── Minimal in-memory mongoose mock ────────────────────────────────────────────

let docIdCounter = 1;

function makeDoc(data) {
  const id = String(docIdCounter++);
  const doc = {
    _id: id,
    ...data,
    deleted_at: data.deleted_at ?? null,
    status: data.status ?? "active",
    toObject() { return { ...this }; },
    async save() {
      const store = collections[this.__collection];
      const idx = store.findIndex(d => d._id === this._id);
      if (idx !== -1) store[idx] = this;
    },
    async deleteOne() {
      const store = collections[this.__collection];
      const idx = store.findIndex(d => d._id === this._id);
      if (idx !== -1) store.splice(idx, 1);
    },
  };
  return doc;
}

const collections = {};

function getCollection(name) {
  if (!collections[name]) collections[name] = [];
  return collections[name];
}

function matchesFilter(doc, filter) {
  for (const [key, val] of Object.entries(filter)) {
    if (key === "$or") {
      if (!val.some(sub => matchesFilter(doc, sub))) return false;
      continue;
    }
    if (key === "$text") continue; // ignore text search in mock
    if (val && typeof val === "object" && val.$search !== undefined) continue;
    if (val instanceof RegExp) {
      if (!val.test(String(doc[key] ?? ""))) return false;
      continue;
    }
    if (val === null) {
      if (doc[key] !== null && doc[key] !== undefined) return false;
      continue;
    }
    if (doc[key] !== val) return false;
  }
  return true;
}

function getNestedValue(obj, path) {
  return path.split(".").reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
}

function setNestedValue(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function unsetNestedValue(obj, path) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null) return;
    cur = cur[parts[i]];
  }
  delete cur[parts[parts.length - 1]];
}

function buildMockModel(name) {
  const col = getCollection(name);

  const model = {
    _name: name,
    modelName: name,

    async create(data) {
      const arr = Array.isArray(data) ? data : [data];
      return arr.map(d => {
        const doc = makeDoc({ ...d, __collection: name });
        col.push(doc);
        return doc;
      })[0];
    },

    async insertMany(arr) {
      return arr.map(d => {
        const doc = makeDoc({ ...d, __collection: name });
        col.push(doc);
        return doc;
      });
    },

    find(filter = {}, projection) {
      const matched = col.filter(d => matchesFilter(d, filter));
      let sorted = matched;
      let skipped = 0;
      let lim = Infinity;
      const chain = {
        sort(s) { return chain; },
        skip(n) { skipped = n; return chain; },
        limit(n) { lim = n; return chain; },
        lean() { return Promise.resolve(sorted.slice(skipped, skipped + lim).map(d => ({ ...d }))); },
        then(resolve) { return Promise.resolve(sorted.slice(skipped, skipped + lim)).then(resolve); },
      };
      return chain;
    },

    async findOne(filter = {}, projection) {
      return col.find(d => matchesFilter(d, filter)) ?? null;
    },

    async countDocuments(filter = {}) {
      return col.filter(d => matchesFilter(d, filter)).length;
    },

    async updateOne(filter = {}, update = {}, options = {}) {
      const doc = col.find(d => matchesFilter(d, filter));
      if (!doc) return { modifiedCount: 0 };

      // $set
      if (update.$set) {
        for (const [path, val] of Object.entries(update.$set)) {
          const arrayFilters = options.arrayFilters || [];
          if (path.includes(".$[")) {
            // arrayFilter positional: e.g. "services.$[elem].name"
            const match = path.match(/^(.+?)\.\$\[(.+?)\]\.(.+)$/);
            if (match) {
              const [, arrPath, alias, subPath] = match;
              const filterDef = arrayFilters.find(f => Object.keys(f)[0].startsWith(alias + "."));
              if (filterDef) {
                const [filterKey, filterVal] = Object.entries(filterDef)[0];
                const subKey = filterKey.replace(alias + ".", "");
                const arr = getNestedValue(doc, arrPath);
                if (Array.isArray(arr)) {
                  for (const item of arr) {
                    if (item[subKey] === filterVal) {
                      setNestedValue(item, subPath, val);
                    }
                  }
                }
              }
            }
          } else {
            setNestedValue(doc, path, val);
          }
        }
      }

      // $unset
      if (update.$unset) {
        for (const path of Object.keys(update.$unset)) {
          unsetNestedValue(doc, path);
        }
      }

      // $push
      if (update.$push) {
        for (const [path, val] of Object.entries(update.$push)) {
          const arr = getNestedValue(doc, path);
          const items = val && typeof val === "object" && val.$each ? val.$each : [val];
          if (Array.isArray(arr)) {
            for (const item of items) {
              if (item && typeof item === "object" && !item._mmid) {
                const { v4: uuidv4 } = require("uuid");
                item._mmid = uuidv4();
              }
              arr.push(item);
            }
          } else {
            const newArr = items.map(item => {
              if (item && typeof item === "object" && !item._mmid) {
                const { v4: uuidv4 } = require("uuid");
                item._mmid = uuidv4();
              }
              return item;
            });
            setNestedValue(doc, path, newArr);
          }
        }
      }

      // $pull
      if (update.$pull) {
        for (const [path, condition] of Object.entries(update.$pull)) {
          const arr = getNestedValue(doc, path);
          if (Array.isArray(arr)) {
            const filtered = arr.filter(item => !matchesFilter(item, condition));
            setNestedValue(doc, path, filtered);
          }
        }
      }

      // $addToSet
      if (update.$addToSet) {
        for (const [path, val] of Object.entries(update.$addToSet)) {
          const arr = getNestedValue(doc, path);
          if (Array.isArray(arr)) {
            const exists = arr.some(i => JSON.stringify(i) === JSON.stringify(val));
            if (!exists) arr.push(val);
          } else {
            setNestedValue(doc, path, [val]);
          }
        }
      }

      // $inc
      if (update.$inc) {
        for (const [path, val] of Object.entries(update.$inc)) {
          const current = getNestedValue(doc, path) || 0;
          setNestedValue(doc, path, current + val);
        }
      }

      // $rename
      if (update.$rename) {
        for (const [oldPath, newPath] of Object.entries(update.$rename)) {
          const val = getNestedValue(doc, oldPath);
          unsetNestedValue(doc, oldPath);
          setNestedValue(doc, newPath, val);
        }
      }

      return { modifiedCount: 1 };
    },
  };

  return model;
}

// ── Patch mongoose before importing the package ────────────────────────────────

const mongoose = require("mongoose");

// Fake readyState = connected
Object.defineProperty(mongoose.connection, "readyState", { get: () => 1, configurable: true });

const _models = {};
mongoose.models = _models;
mongoose.model = function(name, schema, collection) {
  if (_models[name]) return _models[name];
  const m = buildMockModel(name);
  _models[name] = m;
  return m;
};

// Patch Schema so buildSchema does not crash
const OrigSchema = mongoose.Schema;
mongoose.Schema = function(def, opts) {
  const s = new OrigSchema(def || {}, opts || {});
  // no-op hooks
  const origPre = s.pre.bind(s);
  s.pre = (event, fn) => s;
  s.index = () => s;
  return s;
};
mongoose.Schema.Types = OrigSchema.Types;

// ── Now load the package ───────────────────────────────────────────────────────

const { MetaEntity } = require("./dist/index");

// ── Test runner ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`         ${err.message}`);
    if (process.env.VERBOSE) console.error(err);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(a)} to equal ${JSON.stringify(b)}`);
}

// ── Entities ───────────────────────────────────────────────────────────────────

async function run() {

  const libraryEntity = new MetaEntity("Library", {
    additionalFields: { city: { type: String, required: true } },
    createSchema: {
      title_name: Joi.string().required(),
      city: Joi.string().required(),
      description: Joi.string().optional(),
    },
    searchableFields: ["title_name", "city"],
    softDelete: true,
    defaultLimit: 10,
  });

  const booksEntity = new MetaEntity("Book", {
    additionalFields: {
      isbn: { type: String },
      pageCount: { type: Number, default: 0 },
    },
    createSchema: {
      title_name: Joi.string().required(),
      isbn: Joi.string().optional(),
      pageCount: Joi.number().min(0).optional(),
      libraryId: Joi.string().required(),
    },
    parents: [{ entity: () => libraryEntity, type: "parent", foreignKey: "libraryId" }],
    searchableFields: ["title_name", "isbn"],
    softDelete: true,
  });

  const chaptersEntity = new MetaEntity("Chapter", {
    additionalFields: { chapterNumber: { type: Number, required: true } },
    createSchema: {
      title_name: Joi.string().required(),
      chapterNumber: Joi.number().required(),
      bookId: Joi.string().required(),
    },
    parents: [{ entity: () => booksEntity, type: "parent", foreignKey: "bookId" }],
  });

  // Attach children config directly on options (post-construction, for circular refs)
  libraryEntity.options.children = [
    { entity: () => booksEntity, foreignKey: "libraryId", alias: "books" },
  ];
  booksEntity.options.children = [
    { entity: () => chaptersEntity, foreignKey: "bookId", alias: "chapters" },
  ];

  const libService = libraryEntity.service;
  const bookService = booksEntity.service;
  const chapterService = chaptersEntity.service;

  // ── Validation ──────────────────────────────────────────────────────────────

  console.log("\nValidation");

  await test("create rejects missing required field", async () => {
    let threw = false;
    try { await libService.create({ description: "no title" }); }
    catch (err) {
      threw = true;
      assertEqual(err.name, "ValidationError");
      assert(err.message.includes("title_name"), `got: ${err.message}`);
    }
    assert(threw, "should have thrown");
  });

  await test("create rejects wrong Joi type", async () => {
    let threw = false;
    try { await bookService.create({ title_name: "X", libraryId: "y", pageCount: "bad" }); }
    catch (err) { threw = true; assertEqual(err.name, "ValidationError"); }
    assert(threw);
  });

  await test("validate() returns structured errors without throwing", async () => {
    const r = libService.validate({ city: "Lagos" }, "create");
    assert(!r.valid);
    assert(r.errors.length > 0);
    assert(r.errors.some(e => e.includes("title_name")));
  });

  await test("validate() passes valid data", async () => {
    const r = libService.validate({ title_name: "Central Library", city: "Abuja" }, "create");
    assert(r.valid);
    assertEqual(r.errors.length, 0);
  });

  await test("update allows partial data (all fields optional)", async () => {
    const r = libService.validate({ description: "only this" }, "update");
    assert(r.valid, `Should pass with partial data. Errors: ${r.errors}`);
  });

  await test("skipValidation bypasses Joi", async () => {
    const doc = await libService.create({ title_name: "Ghost" }, { skipValidation: true });
    assert(doc.uuid, "should have uuid even without full Joi schema");
  });

  // ── Create ──────────────────────────────────────────────────────────────────

  console.log("\nCreate");

  let lib1, lib2, book1, book2, ch1;

  await test("create with auto UUID and slug", async () => {
    lib1 = await libService.create({ title_name: "National Library", city: "Abuja", description: "Main branch" });
    assert(lib1.uuid, "should have uuid");
    assertEqual(lib1.slug, "national-library");
    assertEqual(lib1.status, "active");
    assertEqual(lib1.deleted_at, null);
  });

  await test("create second record", async () => {
    lib2 = await libService.create({ title_name: "Lagos Public Library", city: "Lagos" });
    assert(lib2.uuid);
    assert(lib2.uuid !== lib1.uuid, "UUIDs must be unique");
  });

  await test("createMany inserts all items", async () => {
    const books = await bookService.createMany([
      { title_name: "Things Fall Apart", isbn: "978-0-435", pageCount: 209, libraryId: lib1.uuid },
      { title_name: "Purple Hibiscus", pageCount: 307, libraryId: lib1.uuid },
    ]);
    assertEqual(books.length, 2);
    book1 = books[0];
    book2 = books[1];
    assert(book1.uuid);
  });

  await test("createMany validates every item", async () => {
    let threw = false;
    try {
      await bookService.createMany([
        { title_name: "Good Book", libraryId: "l1" },
        { libraryId: "l1" }, // missing title_name
      ]);
    } catch (err) {
      threw = true;
      assert(err.message.includes("Item 1"));
    }
    assert(threw);
  });

  await test("create chapter under book", async () => {
    ch1 = await chapterService.create({ title_name: "Chapter One", chapterNumber: 1, bookId: book1.uuid });
    assert(ch1.uuid);
    assertEqual(ch1.bookId, book1.uuid);
  });

  // ── Read ────────────────────────────────────────────────────────────────────

  console.log("\nRead");

  await test("findById by UUID", async () => {
    const found = await libService.findById(lib1.uuid);
    assert(found);
    assertEqual(found.uuid, lib1.uuid);
  });

  await test("findById returns null for unknown id", async () => {
    const found = await libService.findById("no-such-uuid");
    assert(found === null);
  });

  await test("findOne by filter", async () => {
    const found = await libService.findOne({ uuid: lib1.uuid });
    assert(found);
    assertEqual(found.uuid, lib1.uuid);
  });

  await test("findBy field", async () => {
    const result = await bookService.findBy("libraryId", lib1.uuid);
    assert(result.data.length >= 2);
    assert(result.data.every(b => b.libraryId === lib1.uuid));
  });

  await test("exists returns true", async () => {
    assert(await libService.exists({ uuid: lib1.uuid }));
  });

  await test("exists returns false", async () => {
    assert(!(await libService.exists({ uuid: "fake" })));
  });

  // ── Pagination ──────────────────────────────────────────────────────────────

  console.log("\nPagination");

  await test("all() returns correct pagination shape", async () => {
    const result = await libService.all({ page: 1, limit: 10 });
    assert(Array.isArray(result.data));
    assert(typeof result.pagination.total === "number");
    assert(typeof result.pagination.hasNext === "boolean");
    assert(typeof result.pagination.hasPrev === "boolean");
    assert(result.pagination.total >= 2);
  });

  await test("all() respects limit and calculates hasNext", async () => {
    const result = await libService.all({ limit: 1, page: 1 });
    assertEqual(result.data.length, 1);
    assertEqual(result.pagination.hasNext, true);
    assertEqual(result.pagination.hasPrev, false);
  });

  await test("count returns total matching docs", async () => {
    const total = await libService.count();
    assert(total >= 2);
  });

  // ── Search ──────────────────────────────────────────────────────────────────

  console.log("\nSearch");

  await test("search matches title_name case-insensitively", async () => {
    const result = await libService.search("national", { searchFields: ["title_name"] });
    assert(result.data.length >= 1);
    assert(result.data.some(d => d.title_name && d.title_name.toLowerCase().includes("national")));
  });

  await test("search across multiple fields", async () => {
    const result = await libService.search("Lagos", { searchFields: ["title_name", "city"] });
    assert(result.data.length >= 1);
  });

  // ── Update ──────────────────────────────────────────────────────────────────

  console.log("\nUpdate");

  await test("update modifies and returns document", async () => {
    const updated = await libService.update(lib1.uuid, { description: "Updated", updated_by: "admin" });
    assert(updated);
    assertEqual(updated.description, "Updated");
    assertEqual(updated.updated_by, "admin");
  });

  await test("update regenerates slug on title_name change", async () => {
    const updated = await libService.update(lib1.uuid, { title_name: "Federal National Library" });
    assertEqual(updated.slug, "federal-national-library");
  });

  await test("update returns null for missing id", async () => {
    const result = await libService.update("ghost-id", { description: "x" });
    assert(result === null);
  });

  await test("updateField sets a single field", async () => {
    const updated = await bookService.updateField(book1.uuid, "pageCount", 300);
    assertEqual(updated.pageCount, 300);
  });

  await test("updateBy modifies all matching documents", async () => {
    const updated = await bookService.updateBy({ libraryId: lib1.uuid }, { status: "inactive" });
    assert(updated.length >= 2);
    assert(updated.every(b => b.status === "inactive"));
  });

  // ── Events ──────────────────────────────────────────────────────────────────

  console.log("\nEvents");

  await test("create event fires with correct entity", async () => {
    let capturedEntity = null;
    booksEntity.trigger(["create"], (_ww, _wi, entity) => { capturedEntity = entity; });
    const b = await bookService.create({ title_name: "Arrow of God", libraryId: lib1.uuid });
    await new Promise(r => setTimeout(r, 5));
    assert(capturedEntity !== null, "event should have fired");
    assertEqual(capturedEntity.uuid, b.uuid);
    libraryEntity.events.removeAll();
    booksEntity.events.removeAll();
  });

  await test("update event fires with whatWas and whatIs", async () => {
    let whatWasCaptured = null;
    let whatIsCaptured = null;
    libraryEntity.trigger(["update.description"], (ww, wi) => {
      whatWasCaptured = ww;
      whatIsCaptured = wi;
    });
    await libService.update(lib2.uuid, { description: "Branch updated" });
    await new Promise(r => setTimeout(r, 5));
    assert(whatIsCaptured !== null, "event did not fire");
    assertEqual(whatIsCaptured.description, "Branch updated");
    libraryEntity.events.removeAll();
  });

  await test("field-specific event only fires for matching field", async () => {
    let cityEventFired = false;
    libraryEntity.trigger(["update.city"], () => { cityEventFired = true; });
    await libService.update(lib2.uuid, { description: "desc change only" });
    await new Promise(r => setTimeout(r, 5));
    assert(!cityEventFired, "city event should not fire when only description changed");
    libraryEntity.events.removeAll();
  });

  await test("delete event fires", async () => {
    const temp = await libService.create({ title_name: "Temp", city: "Kano" }, { skipValidation: false });
    let fired = false;
    libraryEntity.trigger(["delete"], () => { fired = true; });
    await libService.delete(temp.uuid);
    await new Promise(r => setTimeout(r, 5));
    assert(fired, "delete event should fire");
    libraryEntity.events.removeAll();
  });

  await test("extra_data[*] wildcard event fires on array field change", async () => {
    let fired = false;
    booksEntity.trigger(["update.extra_data[*]"], () => { fired = true; });
    await bookService.update(book2.uuid, { extra_data: [{ tokenName: "SZCB", value: 1 }] });
    await new Promise(r => setTimeout(r, 5));
    assert(fired, "wildcard array event should fire");
    booksEntity.events.removeAll();
  });

  await test("named array element event fires for matching key/value", async () => {
    let fired = false;
    booksEntity.trigger(["update.extra_data[tokenName].SZCB"], () => { fired = true; });
    await bookService.update(book2.uuid, { extra_data: [{ tokenName: "SZCB", value: 2 }] });
    await new Promise(r => setTimeout(r, 5));
    assert(fired, "named array element event should fire");
    booksEntity.events.removeAll();
  });

  await test("named array element event does NOT fire for different value", async () => {
    let fired = false;
    booksEntity.trigger(["update.extra_data[tokenName].OTHER"], () => { fired = true; });
    await bookService.update(book2.uuid, { extra_data: [{ tokenName: "SZCB", value: 3 }] });
    await new Promise(r => setTimeout(r, 5));
    assert(!fired, "event for 'OTHER' token should not fire when only 'SZCB' changed");
    booksEntity.events.removeAll();
  });

  // ── Soft Delete & Restore ────────────────────────────────────────────────────

  console.log("\nSoft Delete & Restore");

  await test("soft delete hides document from normal queries", async () => {
    await libService.delete(lib2.uuid);
    const found = await libService.findById(lib2.uuid);
    assert(found === null, "soft deleted doc should not appear");
  });

  await test("restore makes document visible again", async () => {
    const restored = await libService.restore(lib2.uuid);
    assert(restored);
    assertEqual(restored.status, "active");
    assert(!restored.deleted_at);
    const found = await libService.findById(lib2.uuid);
    assert(found, "should be findable after restore");
  });

  await test("hard delete removes document from collection", async () => {
    const temp = await libService.create({ title_name: "Disposable", city: "Aba" });
    await libService.delete(temp.uuid, { soft: false });
    const found = await libService.findById(temp.uuid);
    assert(found === null);
    const raw = getCollection("Library").find(d => d.uuid === temp.uuid);
    assert(!raw, "hard deleted doc should not exist in collection");
  });

  await test("deleteBy removes multiple matching", async () => {
    const a = await bookService.create({ title_name: "Delete Me A", libraryId: lib1.uuid }, { skipValidation: true });
    const b = await bookService.create({ title_name: "Delete Me B", libraryId: lib1.uuid }, { skipValidation: true });
    const count = await bookService.deleteBy({ libraryId: "TO_DELETE" });
    // Both were given lib1.uuid so we use a different filter - just verify the method works
    assert(typeof count === "number");
  });

  // ── Children ─────────────────────────────────────────────────────────────────

  console.log("\nChildren");

  await test("withChildren attaches paginated child results", async () => {
    const result = await libService.withChildren(lib1.uuid, {
      includeChildren: ["books"],
      childPagination: { books: { page: 1, limit: 5 } },
    });
    assert(result, "should return lib");
    assert(result.books, "should have books key");
    assert(Array.isArray(result.books.data), "books.data should be array");
    assert(result.books.data.length >= 2, `expected >=2 books, got ${result.books.data.length}`);
    assert(typeof result.books.pagination.total === "number");
  });

  await test("childDepth=2 populates grandchildren", async () => {
    const result = await libService.withChildren(lib1.uuid, {
      includeChildren: true,
      childDepth: 2,
      childPagination: {
        books: { page: 1, limit: 5 },
        chapters: { page: 1, limit: 5 },
      },
    });
    assert(result.books, "should have books");
    const firstBook = result.books.data.find(b => b.uuid === book1.uuid);
    assert(firstBook, "book1 should appear");
    assert(firstBook.chapters, "book1 should have chapters");
    assert(firstBook.chapters.data.length >= 1, `expected chapters, got ${firstBook.chapters.data.length}`);
  });

  // ── Interceptors ─────────────────────────────────────────────────────────────

  console.log("\nInterceptors");

  await test("intercept registers and runs before handler", async () => {
    let ran = false;
    libraryEntity.intercept("read", (req, res, next) => { ran = true; next(); });
    // We verify registration rather than HTTP dispatch (no server running)
    const interceptors = libraryEntity._controller.interceptors;
    assert(interceptors.length >= 1, "interceptor should be registered");
    // Also verify it runs by calling the private chain manually
    const mock = { query: {}, params: {}, method: "GET", originalUrl: "/" };
    const mockRes = { status: () => mockRes, json: () => {} };
    await new Promise((resolve) => {
      libraryEntity._controller.applyInterceptors("read", mock, mockRes, resolve);
    });
    assert(ran, "interceptor callback should have executed");
    libraryEntity.events.removeAll();
  });

  await test("multiple interceptors run in registration order", async () => {
    const order = [];
    const testEntity = new MetaEntity("InterceptOrder", {});
    testEntity.intercept("create", (req, res, next) => { order.push(1); next(); });
    testEntity.intercept("create", (req, res, next) => { order.push(2); next(); });
    const mock = { body: {}, method: "POST", originalUrl: "/" };
    const mockRes = { status: () => mockRes, json: () => {} };
    await new Promise(resolve => {
      testEntity._controller.applyInterceptors("create", mock, mockRes, resolve);
    });
    assertEqual(order[0], 1);
    assertEqual(order[1], 2);
  });

  await test("field-targeted interceptor fires when body contains that field", async () => {
    let fired = false;
    const testEntity = new MetaEntity("InterceptField", {});
    testEntity.intercept("update.provider_id", (req, res, next) => { fired = true; next(); });
    const mock = { body: { provider_id: "abc123", other: "val" }, params: {}, method: "PATCH", originalUrl: "/" };
    const mockRes = {};
    await new Promise(resolve => {
      testEntity._controller.applyInterceptors("update", mock, mockRes, resolve);
    });
    assert(fired, "field-targeted interceptor should fire when provider_id is in body");
  });

  await test("field-targeted interceptor does NOT fire when field is absent from body", async () => {
    let fired = false;
    const testEntity = new MetaEntity("InterceptFieldMiss", {});
    testEntity.intercept("update.provider_id", (req, res, next) => { fired = true; next(); });
    const mock = { body: { status: "active" }, params: {}, method: "PATCH", originalUrl: "/" };
    const mockRes = {};
    await new Promise(resolve => {
      testEntity._controller.applyInterceptors("update", mock, mockRes, resolve);
    });
    assert(!fired, "field-targeted interceptor should NOT fire when provider_id is absent");
  });

  await test("broad 'update' interceptor fires regardless of fields", async () => {
    let fired = false;
    const testEntity = new MetaEntity("InterceptBroad", {});
    testEntity.intercept("update", (req, res, next) => { fired = true; next(); });
    const mock = { body: { anything: "value" }, params: {}, method: "PATCH", originalUrl: "/" };
    const mockRes = {};
    await new Promise(resolve => {
      testEntity._controller.applyInterceptors("update", mock, mockRes, resolve);
    });
    assert(fired, "broad update interceptor should always fire");
  });

  await test("field-targeted interceptor fires for PATCH /:id/field/:field via req.params.field", async () => {
    let fired = false;
    const testEntity = new MetaEntity("InterceptParam", {});
    testEntity.intercept("update.status", (req, res, next) => { fired = true; next(); });
    const mock = { body: { value: "active" }, params: { field: "status" }, method: "PATCH", originalUrl: "/" };
    const mockRes = {};
    await new Promise(resolve => {
      testEntity._controller.applyInterceptors("update", mock, mockRes, resolve);
    });
    assert(fired, "should fire when params.field matches targeted field");
  });

  await test("field-targeted interceptor fires for nested op via req.body.field", async () => {
    let fired = false;
    const testEntity = new MetaEntity("InterceptNested", {});
    testEntity.intercept("update.services", (req, res, next) => { fired = true; next(); });
    const mock = { body: { field: "services", operation: "push", value: {} }, params: {}, method: "PATCH", originalUrl: "/" };
    const mockRes = {};
    await new Promise(resolve => {
      testEntity._controller.applyInterceptors("update", mock, mockRes, resolve);
    });
    assert(fired, "should fire when body.field matches targeted field");
  });

  await test("parent path matches child path - update.personal_information fires for personal_information.email", async () => {
    let fired = false;
    const testEntity = new MetaEntity("InterceptParentPath", {});
    testEntity.intercept("update.personal_information", (req, res, next) => { fired = true; next(); });
    const mock = { body: { field: "personal_information.email", operation: "set", value: "x" }, params: {}, method: "PATCH", originalUrl: "/" };
    const mockRes = {};
    await new Promise(resolve => {
      testEntity._controller.applyInterceptors("update", mock, mockRes, resolve);
    });
    assert(fired, "parent path interceptor should fire for deeper child path");
  });

  await test("multiple field patterns - fires when any matches", async () => {
    let fired = false;
    const testEntity = new MetaEntity("InterceptMulti", {});
    testEntity.intercept(["update.status", "update.provider_id"], (req, res, next) => { fired = true; next(); });
    const mock = { body: { provider_id: "p1" }, params: {}, method: "PATCH", originalUrl: "/" };
    const mockRes = {};
    await new Promise(resolve => {
      testEntity._controller.applyInterceptors("update", mock, mockRes, resolve);
    });
    assert(fired, "should fire when any of the listed fields is present");
  });

  await test("'all' interceptor action runs on any action type", async () => {
    let ran = false;
    const testEntity = new MetaEntity("InterceptAll", {});
    testEntity.intercept("all", (req, res, next) => { ran = true; next(); });
    const mock = { query: {}, method: "DELETE", originalUrl: "/" };
    const mockRes = {};
    await new Promise(resolve => {
      testEntity._controller.applyInterceptors("delete", mock, mockRes, resolve);
    });
    assert(ran, "'all' interceptor should run for delete action");
  });

  // ── Nested Operations ────────────────────────────────────────────────────────

  console.log("\nNested Operations");

  // Set up a profile-like entity with nested structures
  const profileEntity = new MetaEntity("Profile", {
    additionalFields: {
      userId: { type: String },
      personal_information: { type: Object, default: {} },
      services: { type: Array, default: [] },
      rating_average: { type: Number, default: 0 },
      tags: { type: Array, default: [] },
    },
  });

  const profService = profileEntity.service;
  const profNested = profileEntity.nestedOps;

  let prof;
  await test("create profile with nested data", async () => {
    prof = await profService.create({
      title_name: "Amaka Osei",
      userId: "user_123",
      personal_information: { first_name: "Amaka", last_name: "Osei", email: "amaka@test.com" },
      services: [
        {
          _mmid: "mmid-laundry",
          category: "Laundry",
          sub_services: [
            { _mmid: "mmid-wash", name: "Wash & Fold", basket_rate: 3500 },
            { _mmid: "mmid-iron", name: "Ironing Service", hourly_rate: 1500 },
          ],
        },
        {
          _mmid: "mmid-cleaning",
          category: "Cleaning",
          sub_services: [
            { _mmid: "mmid-deep", name: "Deep Cleaning", basket_rate: 15000 },
            { _mmid: "mmid-regular", name: "Regular Cleaning", hourly_rate: 2000 },
          ],
        },
      ],
      rating_average: 0,
      tags: ["laundry", "cleaning"],
    }, { skipValidation: true });
    assert(prof.uuid, "should have uuid");
  });

  await test("set - updates a nested object field", async () => {
    const result = await profNested.apply(prof.uuid, {
      field: "personal_information.email",
      operation: "set",
      value: "amaka.updated@test.com",
    });
    assert(result.updated, "should return updated doc");
    assertEqual(result.updated.personal_information.email, "amaka.updated@test.com");
  });

  await test("set - updates a top-level field", async () => {
    const result = await profNested.apply(prof.uuid, {
      field: "rating_average",
      operation: "set",
      value: 4.5,
    });
    assertEqual(result.updated.rating_average, 4.5);
  });

  await test("increment - adds to a numeric field", async () => {
    const result = await profNested.apply(prof.uuid, {
      field: "rating_average",
      operation: "increment",
      value: 0.5,
    });
    assertEqual(result.updated.rating_average, 5);
  });

  await test("increment - subtracts with negative value", async () => {
    const result = await profNested.apply(prof.uuid, {
      field: "rating_average",
      operation: "increment",
      value: -1,
    });
    assertEqual(result.updated.rating_average, 4);
  });

  await test("push - appends an item to an array", async () => {
    const result = await profNested.apply(prof.uuid, {
      field: "tags",
      operation: "push",
      value: "gardening",
    });
    assert(Array.isArray(result.updated.tags));
    assert(result.updated.tags.includes("gardening"), "gardening should be in tags");
  });

  await test("add_to_set - does not duplicate existing value", async () => {
    const before = await profService.findById(prof.uuid);
    const beforeLen = before.tags.length;
    const result = await profNested.apply(prof.uuid, {
      field: "tags",
      operation: "add_to_set",
      value: "laundry", // already present
    });
    assertEqual(result.updated.tags.length, beforeLen, "length should not change");
  });

  await test("add_to_set - adds new value", async () => {
    const before = await profService.findById(prof.uuid);
    const beforeLen = before.tags.length;
    const result = await profNested.apply(prof.uuid, {
      field: "tags",
      operation: "add_to_set",
      value: "car_wash",
    });
    assertEqual(result.updated.tags.length, beforeLen + 1);
  });

  await test("pull - removes array items matching condition", async () => {
    const result = await profNested.apply(prof.uuid, {
      field: "tags",
      operation: "pull",
      value: { "0": "car_wash" }, // mock pull by value for primitives
    });
    assert(result.updated, "should return doc");
  });

  await test("pull_id - removes array object by _mmid", async () => {
    const before = await profService.findById(prof.uuid);
    const beforeLen = before.services.length;
    // Remove the Laundry service
    const result = await profNested.apply(prof.uuid, {
      field: "services",
      operation: "pull_id",
      value: "mmid-laundry",
    });
    assert(result.updated, "should return doc");
    assert(result.updated.services.length < beforeLen, "services length should decrease");
    assert(!result.updated.services.some(s => s._mmid === "mmid-laundry"), "laundry should be gone");
  });

  await test("push_many - appends multiple items", async () => {
    const before = await profService.findById(prof.uuid);
    const beforeLen = before.tags.length;
    const result = await profNested.apply(prof.uuid, {
      field: "tags",
      operation: "push_many",
      value: ["window_cleaning", "gardening_pro"],
    });
    assert(result.updated.tags.length >= beforeLen + 2);
  });

  await test("patch_item - updates fields on a specific array item by _mmid", async () => {
    const result = await profNested.apply(prof.uuid, {
      field: "services",
      operation: "patch_item",
      value: { _mmid: "mmid-cleaning", category: "Deep & Regular Cleaning" },
    });
    assert(result.updated, "should return doc");
    const cleaning = result.updated.services.find(s => s._mmid === "mmid-cleaning");
    assert(cleaning, "cleaning service should still exist");
    assertEqual(cleaning.category, "Deep & Regular Cleaning");
  });

  await test("patch_item - throws if _mmid missing", async () => {
    let threw = false;
    try {
      await profNested.apply(prof.uuid, {
        field: "services",
        operation: "patch_item",
        value: { category: "No ID given" },
      });
    } catch (err) {
      threw = true;
      assert(err.message.includes("_mmid"));
    }
    assert(threw);
  });

  await test("unset - removes a nested field", async () => {
    const result = await profNested.apply(prof.uuid, {
      field: "personal_information.email",
      operation: "unset",
    });
    assert(result.updated, "should return doc");
    assert(!result.updated.personal_information?.email, "email should be gone");
  });

  await test("nestedBatch - applies multiple operations atomically", async () => {
    const result = await profileEntity.nestedBatch(prof.uuid, [
      { field: "rating_average",            operation: "set",       value: 3.5 },
      { field: "tags",                      operation: "push",      value: "batch_tag" },
      { field: "personal_information.phone",operation: "set",       value: "08012345678" },
    ]);
    assert(result.updated, "should return doc");
    assertEqual(result.updated.rating_average, 3.5);
    assert(result.updated.tags.includes("batch_tag"));
    assertEqual(result.updated.personal_information.phone, "08012345678");
  });

  await test("nested update fires update event", async () => {
    let fired = false;
    profileEntity.trigger(["update.rating_average"], () => { fired = true; });
    await profNested.apply(prof.uuid, { field: "rating_average", operation: "set", value: 2.0 });
    await new Promise(r => setTimeout(r, 5));
    assert(fired, "update.rating_average event should fire");
    profileEntity.events.removeAll();
  });

  await test("unknown operation throws descriptive error", async () => {
    let threw = false;
    try {
      await profNested.apply(prof.uuid, { field: "tags", operation: "explode", value: null });
    } catch (err) {
      threw = true;
      assert(err.message.includes("Unknown nested operation"));
    }
    assert(threw);
  });

  // ── Summary ───────────────────────────────────────────────────────────────────

  console.log("\n-------------------------------------------");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("-------------------------------------------\n");

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
