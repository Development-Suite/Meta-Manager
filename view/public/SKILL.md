# Meta Manager — AI Agent Skill

`@ubyjerome/meta-manager` — MongoDB entity manager for Express.  
Define one `MetaEntity`, get a full REST API, typed service layer, lifecycle events, interceptors, relations, and more. No boilerplate.

---

## When to use

Use this skill whenever building or extending a **Node.js / Express / MongoDB** backend.  
Declare entities instead of writing routes, controllers, validation, and service layers by hand.

---

## Install

```bash
npm install @ubyjerome/meta-manager mongoose express
```

---

## Quick start

```ts
import { MetaEntity } from "@ubyjerome/meta-manager"
import mongoose from "mongoose"
import express from "express"

await mongoose.connect(process.env.MONGO_URI!)

const app = express()
app.use(express.json())

const booksEntity = new MetaEntity("books", {
  searchableFields: ["title_name", "description"],
  softDelete: true,
  defaultSort: "created_at",
  defaultOrder: "desc",
  defaultLimit: 20,
})

app.use("/books", booksEntity.controller)
app.listen(3000)
```

> **Requirement:** `mongoose.connect()` must be called **before** any `new MetaEntity(...)`. The constructor throws immediately if no active Mongoose connection exists.

---

## Generated endpoints

Mounted at e.g. `/books`:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/all` | Paginated list with sort, filter, projection |
| GET | `/search?q=` | Full-text / regex search |
| GET | `/count` | Document count (filterable) |
| GET | `/by/:field/:value` | Find by any field |
| GET | `/exists/:field/:value` | Existence check |
| GET | `/:id` | Single record by UUID or `_id` |
| GET | `/:id/children` | Record with embedded child entities |
| GET | `/:id/history` | Audit log (requires `auditLog` option) |
| POST | `/create` | Create one |
| POST | `/create/many` | Bulk create |
| PUT/PATCH | `/:id` | Full or partial update |
| PATCH | `/:id/field/:field` | Single field update (dot-notation safe) |
| PATCH | `/:id/nested` | Nested operation (set, push, pull, increment, etc.) |
| PATCH | `/:id/nested/batch` | Batch nested operations |
| DELETE | `/:id` | Soft delete (`?hard=true` for permanent) |
| POST | `/:id/restore` | Restore soft-deleted record |

---

## Default document shape

Every entity document inherits these base fields automatically — no need to declare them:

```ts
{
  uuid: string               // auto-generated UUID v4
  request_id?: string
  meta_key?: string
  meta_value?: string
  data_type?: string
  title_name?: string
  description?: string
  entity_featured_url?: string
  extra_data?: unknown[]     // schema-less array
  meta_data?: unknown[]      // schema-less array
  status: "active" | "inactive" | "archived"
  parent_entity_type?: string
  parent_entity?: string
  owned_by?: string
  added_by?: string
  created_by?: string
  updated_by?: string
  slug?: string              // auto-generated from title_name
  deleted_at?: Date
  created_at: Date
  updated_at: Date
}
```

> Avoid naming `additionalFields` with `status` — it collides with the base field. Use a prefixed name like `job_status` instead.

---

## Entity options (full reference)

```ts
new MetaEntity("books", {
  // ── Schema ──────────────────────────────────────────────
  additionalFields: {
    isbn:      { type: String, required: true, unique: true },
    pageCount: { type: Number, default: 0 },
    rating:    { type: Number, min: 0, max: 5 },
  },
  createSchema: { title_name: Joi.string().required() },   // Joi validation for POST /create
  updateSchema: { title_name: Joi.string() },              // Joi validation for PUT/PATCH

  // ── Behaviour ───────────────────────────────────────────
  softDelete: true,
  searchableFields: ["title_name", "description", "isbn"],
  defaultSort: "created_at",       // any field name
  defaultOrder: "desc",            // "asc" | "desc"
  defaultLimit: 20,
  timestamps: true,
  collectionName: "library_books", // overrides MongoDB collection name

  // ── Relations ───────────────────────────────────────────
  parents: [
    { entity: () => libraryEntity, type: "parent", foreignKey: "libraryId" },
  ],
  sisters: [
    { entity: () => authorEntity, type: "sister", foreignKey: "authorId" },
  ],
  children: [
    { entity: () => chaptersEntity, foreignKey: "bookId", alias: "chapters" },
    { entity: () => reviewsEntity,  foreignKey: "bookId", alias: "reviews" },
  ],

  // ── Advanced features ───────────────────────────────────
  fieldPolicy: {
    internal_notes: { read: (req) => req.user?.isAdmin },
  },
  scopedService: { userField: "user", userIdField: "uuid" },
  auditLog: { enabled: true },
  webhooks: [{ events: ["create", "update"], url: "https://..." }],
  virtuals: {
    fullName: { get() { return `${this.first_name} ${this.last_name}` } },
  },
  migrations: [
    { version: 2, up: async (doc) => { doc.newField = doc.oldField; return doc } },
  ],
  serialiser: { transform: (doc) => ({ ...doc, computed: doc.a + doc.b }) },
  populate: [{ path: "libraryId", model: "libraries" }],
  analysis: true,  // enables analysis endpoints
})
```

---

## Query parameters

All `GET` endpoints accept these query parameters:

### Pagination & sorting

```
GET /books/all?page=2&limit=10&sort=title_name&order=asc
```

| Param | Type | Notes |
|-------|------|-------|
| `page` | number | Page number (default: 1) |
| `limit` | number | Results per page (default: `defaultLimit`) |
| `sort` | string | Any field name — string, number, and date fields all sort correctly via Mongoose |
| `order` | `asc` \| `desc` | Sort direction |

> `sort` works on **any field type**: strings sort alphabetically, numbers and dates sort numerically. Override entity defaults per-request — e.g. `?sort=scheduled_at&order=asc` on a date field, or `?sort=amount_snapshot&order=desc` on a number field.

### Field projection

```
GET /books/all?fields=uuid,title_name,status,created_at
```

### Arbitrary filter

```
GET /books/all?filter[status]=active&filter[owned_by]=some-uuid
```

### Search

```
GET /books/search?q=tolkien&searchFields=title_name,description
```

### Children queries

```
# All registered children
GET /books/:id/children?includeChildren=true

# Specific children only
GET /books/:id/children?includeChildren=chapters,reviews

# Control fetch depth (children of children)
GET /books/:id/children?includeChildren=true&childDepth=2

# Per-child pagination, sort, order
GET /books/:id/children?includeChildren=chapters
  &childPage[chapters]=2
  &childLimit[chapters]=5
  &childSort[chapters]=created_at
  &childOrder[chapters]=asc
```

### Cross-collection append

```
GET /books/:id?append=Library-libraryId
GET /books/:id?append=Library-libraryId&append=user-ownedBy
```

---

## Service layer

`entity.service` — use directly in business logic, bypassing HTTP:

```ts
const bookService = booksEntity.service

// Paginated list
const { data, pagination } = await bookService.all({ page: 1, limit: 10, sort: "title_name", order: "asc" })

// By ID (UUID or _id)
const book = await bookService.findById("some-uuid")

// First match
const book = await bookService.findOne({ isbn: "978-3-16-148410-0" })

// Field match (paginated)
const { data } = await bookService.findBy("status", "active", { page: 1, limit: 5 })

// Search
const found = await bookService.search("tolkien", { searchFields: ["title_name"] })

// Create
const book = await bookService.create({ title_name: "The Hobbit", libraryId: "lib-uuid" })

// Bulk create
const books = await bookService.createMany([{ title_name: "..." }, { title_name: "..." }])

// Full or partial update
const updated = await bookService.update("book-uuid", { status: "inactive" })

// Bulk update by filter
await bookService.updateBy({ status: "inactive" }, { status: "archived" })

// Single field (dot-notation safe)
await bookService.updateField("book-uuid", "extra_data.0.tokenName", "NewName")

// Soft delete
await bookService.delete("book-uuid")

// Hard delete
await bookService.delete("book-uuid", { soft: false })

// Bulk delete
await bookService.deleteBy({ status: "archived" })

// Restore
await bookService.restore("book-uuid")

// Count
const total = await bookService.count({ status: "active" })

// Existence
const exists = await bookService.exists({ isbn: "978-3-16-148410-0" })

// Validate without inserting
await bookService.validate(data, "create")

// Record with children
const library = await libraryEntity.service.withChildren("lib-uuid", {
  includeChildren: ["books"],
  childDepth: 2,
  childPagination: { books: { page: 1, limit: 10, sort: "created_at" } },
})
```

---

## Nested operations

```ts
// Single operation via service
await entity.nested(id, { field: "tags",     operation: "push",       value: "new-tag" })
await entity.nested(id, { field: "rating",   operation: "increment",  value: 0.5 })
await entity.nested(id, { field: "services", operation: "patch_item", value: { _mmid: "...", name: "Updated" } })

// Batch operations
await entity.nestedBatch(id, [
  { field: "tags",   operation: "push", value: "verified" },
  { field: "status", operation: "set",  value: "active" },
])
```

Via HTTP:
```
PATCH /books/:id/nested
Body: { "field": "tags", "operation": "push", "value": "new-tag" }

PATCH /books/:id/nested/batch
Body: [{ "field": "tags", "operation": "push", "value": "verified" }, ...]
```

Dot-notation field update via HTTP:
```
PATCH /books/:id/field/extra_data.0.tokenName
Body: { "value": "NewTokenName" }
```

---

## Lifecycle events

Events fire **after** the database operation completes. Async callbacks are supported. Errors inside callbacks are caught and logged — they do not interrupt the HTTP response.

### Event patterns

| Pattern | Fires when |
|---------|-----------|
| `create` | A document is created |
| `update` | Any field on a document changes |
| `update.fieldName` | The specific field `fieldName` changes |
| `update.extra_data[*]` | Any element in the `extra_data` array changes |
| `update.extra_data[tokenName].Zugacoin` | The array element where `tokenName === "Zugacoin"` changes |
| `delete` | A document is deleted |
| `restore` | A soft-deleted document is restored |

```ts
// Create
booksEntity.trigger(["create"], async (_whatWas, _whatIs, book) => {
  sendEmail(book.owned_by, `New book: ${book.title_name}`)
})

// Any update — inspect changed fields
booksEntity.trigger(["update"], (whatWas, whatIs, book) => {
  console.log("Changed fields:", Object.keys(whatIs).join(", "))
})

// Specific field change
booksEntity.trigger(["update.status"], (whatWas, whatIs, book) => {
  console.log(`Status: ${whatWas.status} → ${whatIs.status}`)
})

// Array wildcard
booksEntity.trigger(["update.extra_data[*]"], (whatWas, whatIs, book) => {
  console.log("An extra_data element changed")
})

// Named array element
booksEntity.trigger(["update.extra_data[tokenName].Zugacoin"], (whatWas, whatIs, book) => {
  console.log("Zugacoin token changed", whatWas, whatIs)
})

// Multiple events in one subscription
booksEntity.trigger(["create", "update"], (_w, _wi, book) => {
  rebuildSearchIndex(book.uuid)
})

// Delete
booksEntity.trigger(["delete"], (whatWas, _whatIs, book) => {
  console.log("Deleted:", book.uuid)
})

// Restore
booksEntity.trigger(["restore"], (_w, _wi, book) => {
  console.log("Restored:", book.uuid)
})
```

---

## Interceptors (middleware / RBAC)

Runs **before** the controller action. Full Express middleware signature — call `next()` to proceed or respond early to block.

```ts
// Auth guard
booksEntity.intercept("delete", (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ message: "Forbidden" })
  next()
})

// Scope reads to current user
booksEntity.intercept("read", (req, res, next) => {
  req.query["filter[owned_by]"] = req.user.uuid
  next()
})

// Stamp updated_by before any write
booksEntity.intercept(["create", "update"], async (req, res, next) => {
  req.body.updated_by = req.user?.uuid
  next()
})

// Intercept a specific field update (runs on PATCH /:id/field/:field)
booksEntity.intercept("update.provider_id", async (req, res, next) => {
  // req.params.id — document id
  // req.body.value — new field value
  // validate / enrich / block here
  next()
})

// All actions
booksEntity.intercept("all", (req, res, next) => {
  console.log(`${req.method} ${req.originalUrl}`)
  next()
})
```

Available action values: `"create"`, `"read"`, `"update"`, `"delete"`, `"all"`, or `"update.fieldName"` for field-specific interception.  
Multiple interceptors for the same action run in registration order.

---

## Relations

### Parent

```ts
// chaptersEntity requires bookId on create
const chaptersEntity = new MetaEntity("chapters", {
  parents: [{ entity: () => booksEntity, type: "parent", foreignKey: "bookId" }],
})

await chaptersEntity.service.create({ title_name: "Chapter 1", bookId: "book-uuid" })
```

### Children (populated on parent fetch)

```ts
const booksEntity = new MetaEntity("books", {
  children: [
    { entity: () => chaptersEntity, foreignKey: "bookId", alias: "chapters" },
    { entity: () => reviewsEntity,  foreignKey: "bookId", alias: "reviews" },
  ],
})

// Via service
const book = await booksEntity.service.withChildren("book-uuid", {
  includeChildren: ["chapters"],
  childDepth: 1,
  childPagination: { chapters: { page: 1, limit: 10, sort: "created_at" } },
})

// Via HTTP
// GET /books/:id/children?includeChildren=chapters&childPage[chapters]=2&childLimit[chapters]=5
```

### Sister (peer relation)

```ts
const profileEntity = new MetaEntity("profiles", {
  sisters: [{ entity: () => userEntity, type: "sister", foreignKey: "userId" }],
})
```

---

## Scoped service

Auto-fills `created_by` / `updated_by` from `req.user` and enforces `fieldPolicy` read/write guards:

```ts
const service = entity.serviceFor(req)
// created_by and updated_by stamped automatically
// field-level policies enforced
```

---

## Analysis endpoints

Enable with `analysis: true` in entity options:

```
GET /books/analysis/count-by?field=status
GET /books/analysis/sum?field=rating
GET /books/analysis/average?field=rating
GET /books/analysis/min?field=created_at
GET /books/analysis/max?field=created_at
GET /books/analysis/group-by?field=status&metric=count
GET /books/analysis/distinct?field=category
```

---

## TypeScript

```ts
import { MetaEntity, BaseEntityDocument } from "@ubyjerome/meta-manager"

interface BookDocument extends BaseEntityDocument {
  isbn: string
  pageCount: number
  libraryId: string
}

const booksEntity = new MetaEntity<BookDocument>("books", { ... })

// service is fully typed as IMetaService<BookDocument>
const book = await booksEntity.service.findById("uuid")  // BookDocument | null
```

---

## Links

- **npm**: https://www.npmjs.com/package/@ubyjerome/meta-manager
- **GitHub**: https://github.com/Development-Suite/Meta-Manager
- **Docs**: https://meta.ubongabasijerome.com
- **Postman collection**: https://meta.ubongabasijerome.com/public/collection.postman.json
