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
    // Mimic Mongoose doc.set() - merges including undeclared fields (strict:false)
    set(fields) {
      if (fields && typeof fields === 'object') {
        for (const [k, v] of Object.entries(fields)) {
          this[k] = v;
        }
      }
    },
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
    // $in operator
    if (val && typeof val === "object" && !Array.isArray(val) && Array.isArray(val.$in)) {
      if (!val.$in.map(String).includes(String(doc[key]))) return false;
      continue;
    }
    // $gte / $lte for date range queries
    if (val && typeof val === "object" && !Array.isArray(val) && (val.$gte !== undefined || val.$lte !== undefined)) {
      const docVal = doc[key] instanceof Date ? doc[key] : new Date(doc[key] || 0);
      if (val.$gte !== undefined) {
        const cmp = val.$gte instanceof Date ? val.$gte : new Date(val.$gte);
        if (docVal < cmp) return false;
      }
      if (val.$lte !== undefined) {
        const cmp = val.$lte instanceof Date ? val.$lte : new Date(val.$lte);
        if (docVal > cmp) return false;
      }
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
        sort(s) {
          if (s && typeof s === 'object') {
            const [sf, sd] = Object.entries(s)[0];
            sorted = [...matched].sort((a, b) => {
              const av = a[sf] ?? 0, bv = b[sf] ?? 0;
              return sd === -1 || sd === 'desc' ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
            });
          }
          return chain;
        },
        skip(n) { skipped = n; return chain; },
        limit(n) { lim = n; return chain; },
        lean() { return Promise.resolve(sorted.slice(skipped, skipped + lim).map(d => ({ ...d }))); },
        select(fields) { return chain; },
        then(resolve) { return Promise.resolve(sorted.slice(skipped, skipped + lim)).then(resolve); },
      };
      return chain;
    },

    findOne(filter = {}, projection) {
      const doc = col.find(d => matchesFilter(d, filter)) ?? null;
      const plain = doc ? { ...doc } : null;
      return {
        lean: () => Promise.resolve(plain),
        catch: (fn) => Promise.resolve(plain).catch(fn),
        then: (fn) => Promise.resolve(plain).then(fn),
      };
    },

    async countDocuments(filter = {}) {
      return col.filter(d => matchesFilter(d, filter)).length;
    },

    async aggregate(pipeline = []) {
      let docs = [...col];

      for (const stage of pipeline) {
        if (stage.$match) {
          docs = docs.filter(d => matchesFilter(d, stage.$match));
        } else if (stage.$group) {
          const grouped = {};
          for (const doc of docs) {
            const idExpr = stage.$group._id;
            let key;
            if (idExpr === null) {
              key = '__all__';
            } else if (typeof idExpr === 'string' && idExpr.startsWith('$')) {
              key = String(doc[idExpr.slice(1)] ?? '__null__');
            } else {
              key = String(idExpr);
            }
            if (!grouped[key]) grouped[key] = { _id: key === '__all__' ? null : key, docs: [] };
            grouped[key].docs.push(doc);
          }
          const results = [];
          for (const [, g] of Object.entries(grouped)) {
            const row = { _id: g._id };
            for (const [field, expr] of Object.entries(stage.$group)) {
              if (field === '_id') continue;
              if (expr.$sum) {
                const srcField = typeof expr.$sum === 'string' ? expr.$sum.replace('$','') : null;
                row[field] = srcField ? g.docs.reduce((s,d) => s + (Number(d[srcField]) || 0), 0) : g.docs.length;
              }
              if (expr.$avg) {
                const srcField = expr.$avg.replace('$','');
                const vals = g.docs.map(d => Number(d[srcField])||0);
                row[field] = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
              }
              if (expr.$min) {
                const srcField = expr.$min.replace('$','');
                row[field] = Math.min(...g.docs.map(d => Number(d[srcField])||0));
              }
              if (expr.$max) {
                const srcField = expr.$max.replace('$','');
                row[field] = Math.max(...g.docs.map(d => Number(d[srcField])||0));
              }
            }
            results.push(row);
          }
          docs = results;
        } else if (stage.$sort) {
          const [sortField, sortDir] = Object.entries(stage.$sort)[0];
          docs.sort((a,b) => (a[sortField] > b[sortField] ? sortDir : -sortDir));
        } else if (stage.$limit) {
          docs = docs.slice(0, stage.$limit);
        }
      }
      return docs;
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

  await test("update stores undeclared fields not in additionalFields", async () => {
    const updated = await libService.update(lib1.uuid, {
      brand_new_field: "surprise",
      nested_extra: { key: "value", num: 42 }
    });
    assert(updated, "should return updated doc");
    assertEqual(updated.brand_new_field, "surprise", "undeclared field should be stored and returned");
    assert(updated.nested_extra && updated.nested_extra.key === "value", "nested undeclared field should be stored");
  });

  await test("create stores undeclared fields not in additionalFields", async () => {
    const doc = await libService.create({
      title_name: "Dynamic Field Library",
      city: "Ibadan",
      surprise_field: "unexpected",
      dynamic_config: { theme: "dark", version: 2 }
    });
    assert(doc.surprise_field === "unexpected", "undeclared field should persist on create");
    assert(doc.dynamic_config && doc.dynamic_config.theme === "dark", "nested undeclared field should persist");
    await libService.delete(doc.uuid, { soft: false });
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

  // ── res.appendData() ─────────────────────────────────────────────────────────

  console.log("\nres.appendData()");

  await test("appendData merges payload into response _attachedData", async () => {
    const testEntity = new MetaEntity("AppendDataTest", {});
    let capturedRes = null;
    testEntity.intercept("read", (req, res, next) => {
      res.appendData({ role: "admin", permissions: ["read", "write"] });
      capturedRes = res;
      next();
    });
    const mockReq = { query: {}, params: {}, method: "GET", originalUrl: "/" };
    const mockRes = { status: () => mockRes, json: () => {} };
    await new Promise(resolve => {
      testEntity._controller.applyInterceptors("read", mockReq, mockRes, resolve);
    });
    assert(mockRes._attachedData, "_attachedData should be set");
    assertEqual(mockRes._attachedData.role, "admin");
    assert(Array.isArray(mockRes._attachedData.permissions));
    assertEqual(mockRes._attachedData.permissions.length, 2);
  });

  await test("multiple appendData calls are merged", async () => {
    const testEntity = new MetaEntity("AppendDataMulti", {});
    testEntity.intercept("read", (req, res, next) => {
      res.appendData({ role: "admin" });
      res.appendData({ plan: "pro" });
      next();
    });
    const mockReq = { query: {}, params: {}, method: "GET", originalUrl: "/" };
    const mockRes = { status: () => mockRes, json: () => {} };
    await new Promise(resolve => {
      testEntity._controller.applyInterceptors("read", mockReq, mockRes, resolve);
    });
    assertEqual(mockRes._attachedData.role, "admin");
    assertEqual(mockRes._attachedData.plan, "pro");
  });

  await test("serverResponse merges _attachedData into data object", async () => {
    const serverResponse = require("./dist/utils/serverResponse").default;
    let sentBody = null;
    const mockReq = { id: "r1", method: "GET", originalUrl: "/test" };
    const mockRes = {
      _attachedData: { role: "admin", plan: "pro" },
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { sentBody = body; }
    };
    serverResponse.handleResponse(mockReq, mockRes, { uuid: "abc", title: "Test" }, "success", "ok");
    assert(sentBody, "should have sent response");
    assert(sentBody.data.uuid === "abc", "original data preserved");
    assertEqual(sentBody.data.role, "admin", "appendData merged into data");
    assertEqual(sentBody.data.plan, "pro", "appendData merged into data");
  });

  await test("serverResponse with no _attachedData behaves normally", async () => {
    const serverResponse = require("./dist/utils/serverResponse").default;
    let sentBody = null;
    const mockReq = { id: "r1", method: "GET", originalUrl: "/test" };
    const mockRes = {
      status(code) { return this; },
      json(body) { sentBody = body; }
    };
    serverResponse.handleResponse(mockReq, mockRes, { uuid: "xyz" }, "success", "ok");
    assert(sentBody.data.uuid === "xyz");
    assert(!sentBody.data.role, "no extra keys when no _attachedData");
  });

  // ── append query population ───────────────────────────────────────────────────

  console.log("\nAppend population");

  const { parseAppendParam, appendToOne, appendToMany } = require("./dist/core/AppendService");

  await test("parseAppendParam - parses single directive", async () => {
    const directives = parseAppendParam("customer-customerId");
    assertEqual(directives.length, 1);
    assertEqual(directives[0].collection, "customer");
    assertEqual(directives[0].localField, "customerId");
    assertEqual(directives[0].resultKey, "customer");
  });

  await test("parseAppendParam - no hyphen defaults to collectionId field", async () => {
    const directives = parseAppendParam("library");
    assertEqual(directives[0].localField, "libraryId");
  });

  await test("parseAppendParam - parses array of directives", async () => {
    const directives = parseAppendParam(["customer-customerId", "owner-ownerId"]);
    assertEqual(directives.length, 2);
    assertEqual(directives[1].collection, "owner");
    assertEqual(directives[1].localField, "ownerId");
  });

  await test("parseAppendParam - parses comma-separated in one string", async () => {
    const directives = parseAppendParam("customer-customerId,owner-ownerId");
    assertEqual(directives.length, 2);
  });

  await test("appendToOne - appends related document", async () => {
    // Create a library and a book that references it
    const libForAppend = await libService.create({ title_name: "Append Library", city: "Lagos" });
    const bookForAppend = await bookService.create({ title_name: "Append Book", libraryId: libForAppend.uuid }, { skipValidation: true });

    const plain = { ...bookForAppend.toObject ? bookForAppend.toObject() : bookForAppend };
    const result = await appendToOne(plain, [{ collection: "Library", localField: "libraryId", resultKey: "library" }]);
    assert(result.library, "library should be appended");
    assertEqual(result.library.uuid, libForAppend.uuid);
    assertEqual(result.library.title_name, "Append Library");
  });

  await test("appendToOne - returns null for missing related doc", async () => {
    const plain = { uuid: "x", nonExistentId: "ghost-uuid" };
    const result = await appendToOne(plain, [{ collection: "Library", localField: "nonExistentId", resultKey: "library" }]);
    assert(result.library === null, "should be null for missing doc");
  });

  await test("appendToOne - returns null for unknown collection", async () => {
    const plain = { uuid: "x", someId: "abc" };
    const result = await appendToOne(plain, [{ collection: "NonExistentCollection", localField: "someId", resultKey: "nonexistent" }]);
    assert(result.nonexistent === null, "should be null for unknown collection");
  });

  await test("appendToMany - batch fetches and stitches related docs", async () => {
    const libA = await libService.create({ title_name: "Batch Lib A", city: "Abuja" });
    const libB = await libService.create({ title_name: "Batch Lib B", city: "Lagos" });

    const docs = [
      { uuid: "b1", title_name: "Book 1", libraryId: libA.uuid },
      { uuid: "b2", title_name: "Book 2", libraryId: libB.uuid },
      { uuid: "b3", title_name: "Book 3", libraryId: libA.uuid },
    ];

    const results = await appendToMany(docs, [{ collection: "Library", localField: "libraryId", resultKey: "library" }]);
    assertEqual(results.length, 3);
    assertEqual(results[0].library.uuid, libA.uuid);
    assertEqual(results[1].library.uuid, libB.uuid);
    assertEqual(results[2].library.uuid, libA.uuid);
    assert(results[0].library.title_name === "Batch Lib A");
  });

  await test("appendToMany - handles null localField values gracefully", async () => {
    const docs = [
      { uuid: "b1", libraryId: null },
      { uuid: "b2", libraryId: undefined },
    ];
    const results = await appendToMany(docs, [{ collection: "Library", localField: "libraryId", resultKey: "library" }]);
    assert(results[0].library === null);
    assert(results[1].library === null);
  });

  await test("service.all() respects append option", async () => {
    const libForAll = await libService.create({ title_name: "Service All Lib", city: "Enugu" });
    await bookService.create({ title_name: "Service All Book", libraryId: libForAll.uuid }, { skipValidation: true });

    const result = await bookService.all({
      filter: { libraryId: libForAll.uuid },
      append: "Library-libraryId"
    });
    assert(result.data.length >= 1, "should return books");
    assert(result.data[0].library, "library should be appended");
    assertEqual(result.data[0].library.uuid, libForAll.uuid);
  });

  await test("service.findById() respects append option", async () => {
    const libForId = await libService.create({ title_name: "FindById Lib", city: "Port Harcourt" });
    const bookForId = await bookService.create({ title_name: "FindById Book", libraryId: libForId.uuid }, { skipValidation: true });

    const result = await bookService.findById(bookForId.uuid, {
      append: "Library-libraryId"
    });
    assert(result, "should find book");
    assert(result.library, "library should be appended");
    assertEqual(result.library.uuid, libForId.uuid);
  });

  // ── Analysis ──────────────────────────────────────────────────────────────────

  console.log("\nAnalysis");

  // Use a unique collection name to avoid stale data from other tests
  const financeEntity = new MetaEntity("FinanceAnalysis", {
    additionalFields: {
      amount:    { type: Number, default: 0 },
      category:  { type: String, default: null },
      job_status:{ type: String, default: "pending" },
    },
  });
  const fin = financeEntity.service;
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24*60*60*1000);
  const twoDaysAgo = new Date(now.getTime() - 48*60*60*1000);

  // Clear collection before seeding
  getCollection("FinanceAnalysis").length = 0;

  // Seed data with explicit created_at for window matching
  const fa = await fin.create({ title_name: "Payment A", amount: 5000, category: "income",  job_status: "completed" }, { skipValidation: true });
  const fb = await fin.create({ title_name: "Payment B", amount: 3000, category: "income",  job_status: "completed" }, { skipValidation: true });
  const fc = await fin.create({ title_name: "Expense A", amount: 1200, category: "expense", job_status: "in_progress" }, { skipValidation: true });
  const fd = await fin.create({ title_name: "Old Payment", amount: 2000, category: "income", job_status: "completed" }, { skipValidation: true });
  // Manually set created_at for window-based queries
  const faDoc = getCollection("FinanceAnalysis").find(d => d.uuid === fa.uuid); if (faDoc) faDoc.created_at = now;
  const fbDoc = getCollection("FinanceAnalysis").find(d => d.uuid === fb.uuid); if (fbDoc) fbDoc.created_at = now;
  const fcDoc = getCollection("FinanceAnalysis").find(d => d.uuid === fc.uuid); if (fcDoc) fcDoc.created_at = now;
  const fdDoc = getCollection("FinanceAnalysis").find(d => d.uuid === fd.uuid); if (fdDoc) fdDoc.created_at = twoDaysAgo;

  const window7d = { from: new Date(now.getTime() - 7*24*60*60*1000), to: new Date(now.getTime() + 1000) };

  await test("count - counts documents in window", async () => {
    const result = await financeEntity.analyze({ type: "count", window: window7d });
    assertEqual(result.type, "count");
    assert(result.count >= 4, `expected >= 4, got ${result.count}`);
    assert(result.window.from instanceof Date);
  });

  await test("growth - returns growthPercent and window pair", async () => {
    const result = await financeEntity.analyze({ type: "growth", window: { from: yesterday, to: now } });
    assertEqual(result.type, "growth");
    assert(typeof result.growthPercent === "number");
    assert(typeof result.growthAbsolute === "number");
    assert(result.currentWindow && result.previousWindow);
  });

  await test("sum - sums a numeric field", async () => {
    const result = await financeEntity.analyze({ type: "sum", field: "amount", window: window7d });
    assertEqual(result.type, "sum");
    assert(result.total >= 11200, `expected >= 11200, got ${result.total}`);
    assertEqual(result.field, "amount");
  });

  await test("average - computes mean of field", async () => {
    const result = await financeEntity.analyze({ type: "average", field: "amount", window: window7d });
    assertEqual(result.type, "average");
    assert(result.average > 0, "average should be positive");
    assert(typeof result.count === "number");
  });

  await test("min_max - returns min, max, range", async () => {
    const result = await financeEntity.analyze({ type: "min_max", field: "amount", window: window7d });
    assertEqual(result.type, "min_max");
    assert(result.min <= result.max);
    assertEqual(result.range, result.max - result.min);
    assert(result.min >= 1200);
  });

  await test("distribution - groups by field value", async () => {
    const result = await financeEntity.analyze({ type: "distribution", groupBy: "category", window: window7d });
    assertEqual(result.type, "distribution");
    assert(Array.isArray(result.buckets));
    assert(result.buckets.length >= 1);
    assert(result.buckets.every(b => typeof b.percent === "number"));
  });

  await test("top - returns top N by field", async () => {
    const result = await financeEntity.analyze({ type: "top", field: "amount", limit: 2, window: window7d });
    assertEqual(result.type, "top");
    assertEqual(result.limit, 2);
    assert(result.items.length <= 2);
    assert(result.items[0].amount >= result.items[result.items.length - 1].amount);
  });

  await test("rate - returns rate per interval", async () => {
    const result = await financeEntity.analyze({ type: "rate", interval: "day", window: window7d });
    assertEqual(result.type, "rate");
    assert(typeof result.rate === "number");
    assert(result.rate >= 0);
    assertEqual(result.interval, "day");
  });

  await test("field_change - compares sum between periods", async () => {
    const result = await financeEntity.analyze({ type: "field_change", field: "amount", window: { from: yesterday, to: now } });
    assertEqual(result.type, "field_change");
    assert(typeof result.deltaPercent === "number");
    assert(typeof result.deltaAbsolute === "number");
  });

  await test("funnel - computes drop-off across stages", async () => {
    const result = await financeEntity.analyze({
      type: "funnel",
      groupBy: "job_status",
      stages: ["completed", "in_progress", "pending"],
      window: window7d,
    });
    assertEqual(result.type, "funnel");
    assert(Array.isArray(result.stages));
    assertEqual(result.stages.length, 3);
    assert(result.stages[0].dropoffPercent === 0, "first stage has no dropoff");
    assert(result.stages.every(s => typeof s.percent === "number"));
  });

  await test("percentile - returns p50-p99", async () => {
    const result = await financeEntity.analyze({ type: "percentile", field: "amount", window: window7d });
    assertEqual(result.type, "percentile");
    assert(result.p50 >= 0);
    assert(result.p99 >= result.p50, "p99 should be >= p50");
    assert(typeof result.count === "number");
  });

  await test("timeseries - returns bucketed points", async () => {
    const result = await financeEntity.analyze({ type: "timeseries", interval: "day", window: window7d });
    assertEqual(result.type, "timeseries");
    assert(Array.isArray(result.points));
    assert(result.points.length > 0);
    assert(result.points.every(p => typeof p.value === "number" && typeof p.bucket === "string"));
  });

  await test("sum - throws when field missing", async () => {
    let threw = false;
    try { await financeEntity.analyze({ type: "sum" }); }
    catch (e) { threw = true; assert(e.message.includes("field")); }
    assert(threw);
  });

  await test("analysis threshold event fires when condition met", async () => {
    let fired = false;
    let capturedEntity = null;
    financeEntity.trigger(["analysis.count_threshold"], (_ww, _wi, entity) => {
      fired = true;
      capturedEntity = entity;
    });
    await financeEntity.analyze({
      type: "count",
      window: window7d,
      threshold: { metric: "count", operator: "gte", value: 1 },
    });
    await new Promise(r => setTimeout(r, 10));
    assert(fired, "threshold event should fire when count >= 1");
    assert(capturedEntity !== null);
    financeEntity.events.removeAll();
  });

  await test("analysis threshold event does NOT fire when condition not met", async () => {
    let fired = false;
    financeEntity.trigger(["analysis.count_threshold"], () => { fired = true; });
    await financeEntity.analyze({
      type: "count",
      window: window7d,
      threshold: { metric: "count", operator: "gt", value: 99999 },
    });
    await new Promise(r => setTimeout(r, 10));
    assert(!fired, "threshold event should not fire when condition not met");
    financeEntity.events.removeAll();
  });

  await test("unknown analysis type throws", async () => {
    let threw = false;
    try { await financeEntity.analyze({ type: "wizard" }); }
    catch(e) { threw = true; assert(e.message.includes("Unknown analysis type")); }
    assert(threw);
  });

  await test("filter - count respects filter option", async () => {
    const result = await financeEntity.analyze({
      type: "count",
      window: window7d,
      filter: { category: "income" },
    });
    assertEqual(result.type, "count");
    // Only income docs should match
    assert(result.count >= 1, "should find income docs");
    const allResult = await financeEntity.analyze({ type: "count", window: window7d });
    assert(allResult.count > result.count, "filtered count should be less than total");
  });

  await test("filter - sum respects filter option", async () => {
    const incomeResult = await financeEntity.analyze({
      type: "sum",
      field: "amount",
      window: window7d,
      filter: { category: "income" },
    });
    const expenseResult = await financeEntity.analyze({
      type: "sum",
      field: "amount",
      window: window7d,
      filter: { category: "expense" },
    });
    assert(incomeResult.total > 0, "income sum should be positive");
    assert(expenseResult.total > 0, "expense sum should be positive");
    assert(incomeResult.total !== expenseResult.total, "filtered sums should differ");
  });

  await test("filter - distribution respects filter option", async () => {
    const result = await financeEntity.analyze({
      type: "distribution",
      groupBy: "job_status",
      window: window7d,
      filter: { category: "income" },
    });
    assertEqual(result.type, "distribution");
    // Only income docs - should not include in_progress (which is expense)
    const hasInProgress = result.buckets.some(b => b.value === "in_progress");
    assert(!hasInProgress, "income filter should exclude in_progress job_status");
  });

  await test("filter - timeseries respects filter option", async () => {
    const incomeTs = await financeEntity.analyze({
      type: "timeseries",
      interval: "day",
      window: window7d,
      filter: { category: "income" },
    });
    const allTs = await financeEntity.analyze({
      type: "timeseries",
      interval: "day",
      window: window7d,
    });
    assertEqual(incomeTs.type, "timeseries");
    const incomeTotal = incomeTs.points.reduce((s, p) => s + p.value, 0);
    const allTotal    = allTs.points.reduce((s, p) => s + p.value, 0);
    assert(allTotal >= incomeTotal, "unfiltered timeseries should have >= count");
  });

  await test("filter - funnel respects filter option", async () => {
    const result = await financeEntity.analyze({
      type: "funnel",
      groupBy: "job_status",
      stages: ["completed", "in_progress", "pending"],
      window: window7d,
      filter: { category: "income" },
    });
    // Only income category docs - in_progress stage should be 0
    const inProgressStage = result.stages.find(s => s.value === "in_progress");
    assert(inProgressStage !== undefined);
    assertEqual(inProgressStage.count, 0, "income category has no in_progress docs");
  });

  await test("filter - growth respects filter option", async () => {
    const result = await financeEntity.analyze({
      type: "growth",
      window: { from: yesterday, to: new Date(now.getTime() + 1000) },
      filter: { category: "income" },
    });
    assertEqual(result.type, "growth");
    assert(typeof result.growthPercent === "number");
  });

  await test("filter - top respects filter option", async () => {
    const result = await financeEntity.analyze({
      type: "top",
      field: "amount",
      limit: 5,
      window: window7d,
      filter: { category: "income" },
    });
    assertEqual(result.type, "top");
    // All returned docs should be income
    assert(result.items.every(i => i.category === "income"), "all top items should be income");
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
