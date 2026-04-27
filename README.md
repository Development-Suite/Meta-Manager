# @ubyjerome/meta-manager

MongoDB entity manager for Express. Define an entity once, get a full REST API, typed service layer, lifecycle events, interceptors, and deep parent/child relations, with no repetitive boilerplate.

---

## Install

```bash
npm install @ubyjerome/meta-manager mongoose express
```

---

## Quick Start

```ts
import mongoose from "mongoose";
import express from "express";
import { MetaEntity } from "@ubyjerome/meta-manager";

await mongoose.connect("mongodb://localhost:27017/mydb");

const app = express();
app.use(express.json());

const booksEntity = new MetaEntity("books", {
  searchableFields: ["title_name", "description"],
  defaultSort: "created_at",
  defaultOrder: "desc",
  defaultLimit: 20,
  softDelete: true,
});

app.use("/books", booksEntity.controller);
app.listen(3000);
```

That single mount produces the following endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/books/all` | Paginated list with sort, filter, fields |
| GET | `/books/search?q=term` | Full-text or regex search |
| GET | `/books/count` | Document count with optional filter |
| GET | `/books/by/:field/:value` | Find by any field |
| GET | `/books/exists/:field/:value` | Existence check |
| GET | `/books/:id` | Single record by UUID or `_id` |
| GET | `/books/:id/children` | Record with nested children |
| POST | `/books/create` | Create one |
| POST | `/books/create/many` | Bulk create |
| PUT/PATCH | `/books/:id` | Full or partial update |
| PATCH | `/books/:id/field/:field` | Update a single nested field |
| DELETE | `/books/:id` | Soft delete (add `?hard=true` for hard delete) |
| POST | `/books/:id/restore` | Restore a soft-deleted record |

---

## Default Document Shape

Every entity document inherits these fields automatically:

```ts
{
  uuid: string;              // auto-generated UUID v4
  request_id?: string;
  meta_key?: string;
  meta_value?: string;
  data_type?: string;
  title_name?: string;
  description?: string;
  entity_featured_url?: string;
  extra_data?: unknown[];    // schema-less, accepts anything
  meta_data?: unknown[];     // schema-less, accepts anything
  status: "active" | "inactive" | "archived";
  parent_entity_type?: string;
  parent_entity?: string;
  owned_by?: string;
  added_by?: string;
  created_by?: string;
  updated_by?: string;
  slug?: string;             // auto-generated from title_name
  deleted_at?: Date;
  created_at: Date;
  updated_at: Date;
}
```

---

## Entity Options

```ts
new MetaEntity("books", {
  // Extra schema fields using Mongoose field definition syntax
  additionalFields: {
    isbn: { type: String, required: true, unique: true },
    pageCount: { type: Number, default: 0 },
    rating: { type: Number, min: 0, max: 5 },
  },

  // Fields to run regex/text search against
  searchableFields: ["title_name", "description", "isbn"],

  // Soft delete behaviour (default: true)
  softDelete: true,

  // Default query settings
  defaultSort: "created_at",
  defaultOrder: "desc",
  defaultLimit: 20,

  // Override the MongoDB collection name
  collectionName: "library_books",

  // Parent relations (adds required foreignKey to the schema)
  parents: [
    {
      entity: () => libraryEntity,
      type: "parent",
      foreignKey: "libraryId",
    },
  ],

  // Sister relations (adds required foreignKey to the schema)
  sisters: [
    {
      entity: () => authorEntity,
      type: "sister",
      foreignKey: "authorId",
    },
  ],

  // Declares which entities are children of this one
  children: [
    {
      entity: () => chaptersEntity,
      foreignKey: "bookId",      // field on the child pointing to this entity's UUID
      alias: "chapters",         // key under which paginated results appear
    },
  ],
});
```

---

## Query Parameters

All `GET` endpoints accept these query parameters:

### Pagination & Sorting
```
?page=2&limit=10&sort=title_name&order=asc
```

### Field Projection
```
?fields=uuid,title_name,status,created_at
```

### Arbitrary Filter
```
?filter[status]=active&filter[owned_by]=some-uuid
```

### Search
```
GET /books/search?q=tolkien&searchFields=title_name,description
```

### Children
```
# Include all registered children
GET /books/:id/children?includeChildren=true

# Include specific children only
GET /books/:id/children?includeChildren=chapters,reviews

# Control depth (fetch children of children)
GET /books/:id/children?includeChildren=true&childDepth=2

# Per-child pagination
GET /books/:id/children?includeChildren=chapters&childPage[chapters]=2&childLimit[chapters]=5&childSort[chapters]=created_at&childOrder[chapters]=asc
```

---

## Service Layer

The service exposes all the same logic for use in your own business code:

```ts
const bookService = booksEntity.service;

// Paginated list
const { data, pagination } = await bookService.all({ page: 1, limit: 10, sort: "title_name" });

// By ID (UUID or _id)
const book = await bookService.findById("some-uuid");

// Find by any field
const results = await bookService.findBy("status", "active", { page: 1, limit: 5 });

// Search
const found = await bookService.search("tolkien", { searchFields: ["title_name"] });

// Create
const book = await bookService.create({ title_name: "The Hobbit", libraryId: "lib-uuid" });

// Bulk create
const books = await bookService.createMany([{ title_name: "..." }, { title_name: "..." }]);

// Update
const updated = await bookService.update("book-uuid", { status: "inactive" });

// Update a single field (dot-notation safe)
await bookService.updateField("book-uuid", "extra_data.0.tokenName", "NewName");

// Soft delete
await bookService.delete("book-uuid");

// Hard delete
await bookService.delete("book-uuid", { soft: false });

// Restore
await bookService.restore("book-uuid");

// Count
const total = await bookService.count({ status: "active" });

// Existence
const exists = await bookService.exists({ isbn: "978-3-16-148410-0" });

// Record with children
const library = await libraryEntity.service.withChildren("lib-uuid", {
  includeChildren: ["books"],
  childDepth: 2,
  childPagination: { books: { page: 1, limit: 10 } },
});
```

---

## Lifecycle Events

Subscribe to entity events using `trigger()`. Events fire after the relevant database operation completes.

### Available Event Types

| Pattern | Fires when |
|---------|-----------|
| `create` | A new document is created |
| `update` | Any field on a document changes |
| `update.fieldName` | The specific field `fieldName` changes |
| `update.extra_data[*]` | Any element in the `extra_data` array changes |
| `update.extra_data[tokenName].Zugacoin` | The array element with `tokenName === "Zugacoin"` changes |
| `delete` | A document is deleted |
| `restore` | A soft-deleted document is restored |

```ts
// New document
booksEntity.trigger(["create"], (whatWas, whatIs, book) => {
  sendEmail(book.owned_by, `New book added: ${book.title_name}`);
});

// Any update
booksEntity.trigger(["update"], (whatWas, whatIs, book) => {
  const changedFields = Object.keys(whatIs);
  console.log(`Fields changed: ${changedFields.join(", ")}`);
});

// Specific field change
booksEntity.trigger(["update.status"], (whatWas, whatIs, book) => {
  console.log(`Status changed from ${whatWas.status} to ${whatIs.status}`);
});

// Array element change (any element)
booksEntity.trigger(["update.extra_data[*]"], (whatWas, whatIs, book) => {
  console.log("A token in extra_data was modified");
});

// Specific named array element
booksEntity.trigger(["update.extra_data[tokenName].Zugacoin"], (whatWas, whatIs, book) => {
  console.log("Zugacoin token data changed", whatWas, whatIs);
});

// Multiple events in one subscription
booksEntity.trigger(["create", "update"], (whatWas, whatIs, book) => {
  rebuildSearchIndex(book.uuid);
});

// Deletion
booksEntity.trigger(["delete"], (whatWas, _whatIs, book) => {
  console.log("Deleted:", book.uuid);
});
```

Callbacks may be `async`. Errors inside callbacks are caught and logged — they do not interrupt the HTTP response.

---

## Interceptors (Middleware)

Mount middleware that runs before specific controller actions:

```ts
// Auth guard on delete
booksEntity.intercept("delete", (req, res, next) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
});

// Scope reads to the current user
booksEntity.intercept("read", (req, res, next) => {
  req.query["filter[owned_by]"] = req.user.uuid;
  next();
});

// Multiple actions at once
booksEntity.intercept(["create", "update"], async (req, res, next) => {
  req.body.updated_by = req.user?.uuid;
  next();
});

// All actions
booksEntity.intercept("all", (req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});
```

Available action values: `"create"`, `"read"`, `"update"`, `"delete"`, `"all"`.

Multiple interceptors for the same action run in registration order.

---

## Relations

### Parent (owned-by)

```ts
// chapters requires bookId on create
const chaptersEntity = new MetaEntity("chapters", {
  parents: [
    { entity: () => booksEntity, type: "parent", foreignKey: "bookId" }
  ],
});

// Creating a chapter requires bookId in the body
await chaptersEntity.service.create({ title_name: "Chapter 1", bookId: "book-uuid" });
```

### Children (populated on parent fetch)

```ts
const booksEntity = new MetaEntity("books", {
  children: [
    { entity: () => chaptersEntity, foreignKey: "bookId", alias: "chapters" },
    { entity: () => reviewsEntity, foreignKey: "bookId", alias: "reviews" },
  ],
});

// Via service
const book = await booksEntity.service.withChildren("book-uuid", {
  includeChildren: ["chapters"],
  childDepth: 1,
  childPagination: { chapters: { page: 1, limit: 10, sort: "created_at" } },
});

// Via HTTP
// GET /books/:id/children?includeChildren=chapters&childPage[chapters]=2&childLimit[chapters]=5
```

### Sister (peer relation)

```ts
const profileEntity = new MetaEntity("profiles", {
  sisters: [
    { entity: () => userEntity, type: "sister", foreignKey: "userId" }
  ],
});
```

---

## Updating Nested Fields

The `PATCH /:id/field/:field` endpoint and `updateField()` method accept dot-notation paths:

```bash
# Update a top-level field
PATCH /books/:id/field/status
Body: { "value": "inactive" }

# Update a nested object field
PATCH /books/:id/field/extra_data.0.tokenName
Body: { "value": "NewTokenName" }
```

```ts
await bookService.updateField(id, "extra_data.0.minProcessingAmount", 50);
```

---

## TypeScript

The package ships full `.d.ts` declarations. When building with TypeScript you can type your entities:

```ts
import { MetaEntity, BaseEntityDocument } from "@ubyjerome/meta-manager";

interface BookDocument extends BaseEntityDocument {
  isbn: string;
  pageCount: number;
  libraryId: string;
}

const booksEntity = new MetaEntity<BookDocument>("books", { ... });

// service is fully typed as IMetaService<BookDocument>
const book = await booksEntity.service.findById("uuid");
// book is BookDocument | null
```

---

## MongoDB Connection Requirement

`MetaEntity` checks for an active (connected or connecting) Mongoose connection at instantiation time and throws immediately if none exists. Always call `mongoose.connect()` before creating entity instances.

```ts
await mongoose.connect(process.env.MONGO_URI!);

// Safe to create entities now
const booksEntity = new MetaEntity("books", { ... });
```
