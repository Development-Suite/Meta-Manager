# Meta Manager — AI Agent Skill

Meta Manager turns MongoDB + Express backend development into a single declaration.  
Define an entity once, get a full REST API, typed service layer, lifecycle events, interceptors, relations, audit logging, webhooks, and more.

---

## When to use

Use this skill whenever you need to build or extend a Node.js/Express/MongoDB backend.  
Instead of writing routes, controllers, validation, and service layers by hand, declare entities and let Meta Manager generate everything.

---

## Quick reference

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
  defaultLimit: 20,
})

app.use("/books", booksEntity.controller)
app.listen(3000)
```

That single mount registers 14+ endpoints automatically.

---

## Key concepts

### Entity
The central construct. One `new MetaEntity(name, options)` call produces a Mongoose model, an Express router, a service layer, and an event bus.

### Service
`entity.service` — a typed interface with methods for all CRUD operations, search, pagination, nested operations, and more.

### Controller
`entity.controller` — an Express router with all REST endpoints pre-registered. Mount it at any path.

### Events
Lifecycle callbacks that fire after mutations. Subscribe with `entity.trigger([eventPattern], callback)`. Supports field-level and wildcard patterns.

### Interceptors
Express middleware mounted per action type (`create`, `read`, `update`, `delete`, `all`). Use for RBAC, audit, request augmentation.

### Relations
Parents, children, and sisters — declare them in options and get automatic foreign key injection and nested fetch endpoints.

---

## Generated endpoints (mounted at e.g. `/books`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/all` | Paginated list with sort, filter, projection |
| GET | `/:id` | Single record by UUID or _id |
| GET | `/:id/children` | Record with embedded child entities |
| GET | `/:id/history` | Audit log (requires auditLog option) |
| POST | `/create` | Create one record |
| POST | `/create/many` | Bulk create |
| PUT/PATCH | `/:id` | Full or partial update |
| PATCH | `/:id/field/:field` | Single field update (dot-notation) |
| PATCH | `/:id/nested` | Nested operation (set, push, pull, etc.) |
| PATCH | `/:id/nested/batch` | Batch nested operations |
| DELETE | `/:id` | Soft delete (?hard=true for permanent) |
| POST | `/:id/restore` | Restore soft-deleted record |
| GET | `/search?q=` | Full-text / regex search |
| GET | `/count` | Document count |
| GET | `/exists/:field/:value` | Existence check |
| GET | `/by/:field/:value` | Find by field |

---

## Entity options

```ts
new MetaEntity("books", {
  // Schema
  additionalFields: { ... },
  createSchema: { title_name: Joi.string().required() },
  updateSchema: { ... },

  // Behaviour
  softDelete: true,
  searchableFields: ["title_name", "description"],
  defaultSort: "created_at",
  defaultOrder: "desc",
  defaultLimit: 20,
  timestamps: true,
  collectionName: "library_books",

  // Relations
  parents: [{ entity: () => libEntity, foreignKey: "libraryId" }],
  sisters: [{ entity: () => authorEntity, foreignKey: "authorId" }],
  children: [{ entity: () => chapterEntity, foreignKey: "bookId", alias: "chapters" }],

  // Features
  fieldPolicy: { internal_notes: { read: (req) => req.user?.isAdmin } },
  scopedService: { userField: "user", userIdField: "uuid" },
  auditLog: { enabled: true },
  webhooks: [{ events: ["create", "update"], url: "https://..." }],
  virtuals: { fullName: { get() { return `${this.first_name} ${this.last_name}` } } },
  migrations: [{ version: 2, up: async (doc) => { doc.newField = doc.oldField; return doc } }],
  serialiser: { transform: (doc) => ({ ...doc, computed: doc.a + doc.b }) },
  populate: [{ path: "libraryId", model: "libraries" }],
})
```

---

## Service methods

```ts
entity.service.all(options?)          // Paginated list
entity.service.findById(id, options?) // Single record
entity.service.findOne(filter)        // First match
entity.service.findBy(field, value)   // Field match
entity.service.search(query)          // Search
entity.service.create(data)           // Insert
entity.service.createMany(data[])     // Bulk insert
entity.service.update(id, data)       // Update
entity.service.updateBy(filter, data) // Bulk update
entity.service.updateField(id, field, value) // Single field
entity.service.delete(id)             // Soft/hard delete
entity.service.deleteBy(filter)       // Bulk delete
entity.service.restore(id)            // Restore
entity.service.count(filter?)         // Count
entity.service.exists(filter)         // Existence
entity.service.withChildren(id)       // Fetch with children
entity.service.validate(data, mode)   // Validate without insert
```

---

## Nested operations

```ts
await entity.nested(id, { field: "tags", operation: "push", value: "new-tag" })
await entity.nested(id, { field: "services", operation: "patch_item", value: { _mmid: "...", name: "Updated" } })
await entity.nested(id, { field: "rating", operation: "increment", value: 0.5 })

// Batch
await entity.nestedBatch(id, [
  { field: "tags", operation: "push", value: "verified" },
  { field: "status", operation: "set", value: "active" },
])
```

---

## Events

```ts
entity.trigger(["create"], (whatWas, whatIs, document) => { ... })
entity.trigger(["update.status"], (whatWas, whatIs, document) => { ... })
entity.trigger(["delete"], (whatWas, whatIs, document) => { ... })
entity.trigger(["update.extra_data[*]"], (whatWas, whatIs, document) => { ... })
```

---

## Field policy (scoped service)

```ts
const service = entity.serviceFor(req)
// created_by / updated_by auto-filled from req.user
// Read/write guards from fieldPolicy enforced automatically
```

---

## Append cross-collection data

```bash
GET /books/:id?append=Library-libraryId
GET /books/:id?append=Library-libraryId&append=user-ownedBy
```

---

## Analysis endpoints (when analysis option is enabled)

```bash
GET /books/analysis/count-by?field=status
GET /books/analysis/sum?field=rating
GET /books/analysis/average?field=rating
GET /books/analysis/min?field=created_at
GET /books/analysis/max?field=created_at
GET /books/analysis/group-by?field=status&metric=count
GET /books/analysis/distinct?field=category
```

---

## Links

- **npm**: https://www.npmjs.com/package/@ubyjerome/meta-manager
- **GitHub**: https://github.com/Development-Suite/Meta-Manager
- **Docs**: https://meta.ubongabasijerome.com
- **Postman collection**: https://meta.ubongabasijerome.com/public/collection.postman.json
