"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetaService = void 0;
const AppendService_1 = require("./AppendService");
const queryParser_1 = require("../utils/queryParser");
const PopulationMiddleware_1 = require("./PopulationMiddleware");
const MigrationService_1 = require("./MigrationService");
const MetaValidator_1 = require("./MetaValidator");
const helpers_1 = require("../utils/helpers");
const queryParser_2 = require("../utils/queryParser");
class MetaService {
    constructor(model, options, events, entityName) {
        this.model = model;
        this.options = options;
        this.events = events;
        this.entityName = entityName;
        this.validator = new MetaValidator_1.MetaValidator(options);
        this.migrationSvc = new MigrationService_1.MigrationService(options.migrations || []);
    }
    buildBaseFilter(extra) {
        const f = { deleted_at: null };
        if (extra)
            Object.assign(f, extra);
        return f;
    }
    buildSort(opts) {
        return (0, queryParser_2.buildSortObject)(opts.sort, opts.order, this.options.defaultSort || "created_at", this.options.defaultOrder || "desc");
    }
    buildPagination(opts) {
        const page = Math.max(1, opts.page || 1);
        const limit = Math.min(opts.limit || this.options.defaultLimit || 20, 500);
        return { skip: (page - 1) * limit, limit, page };
    }
    buildProjection(opts) {
        return (0, queryParser_2.buildFieldProjection)(opts.fields);
    }
    toPlain(doc) {
        return doc.toObject ? doc.toObject() : { ...doc };
    }
    async populateChildren(doc, opts) {
        const plain = this.toPlain(doc);
        const children = this.options.children || [];
        const include = opts.includeChildren;
        if (!include || children.length === 0)
            return plain;
        const targetChildren = include === true
            ? children
            : children.filter((c) => {
                const alias = c.alias || c.entity().entityName;
                return include.includes(alias);
            });
        const depth = opts.childDepth ?? 1;
        for (const childConfig of targetChildren) {
            const childEntity = childConfig.entity();
            const alias = childConfig.alias || childEntity.entityName;
            const childPag = opts.childPagination?.[alias] || {};
            const childOpts = {
                page: childPag.page || 1,
                limit: childPag.limit || this.options.defaultLimit || 20,
                sort: childPag.sort,
                order: childPag.order,
                includeChildren: depth > 1 ? true : false,
                childDepth: depth - 1,
            };
            const result = await childEntity.service.findBy(childConfig.foreignKey, plain.uuid || plain._id?.toString(), childOpts);
            // When depth > 1, recursively populate grandchildren on each result item
            if (depth > 1 && childEntity.options?.children?.length > 0) {
                const deepItems = await Promise.all(result.data.map(async (item) => {
                    const itemId = item.uuid || item._id?.toString();
                    if (!itemId)
                        return item;
                    const deep = await childEntity.service.withChildren(itemId, {
                        includeChildren: true,
                        childDepth: depth - 1,
                        childPagination: opts.childPagination,
                    });
                    return deep ?? item;
                }));
                plain[alias] = { ...result, data: deepItems };
            }
            else {
                plain[alias] = result;
            }
        }
        return plain;
    }
    validate(data, mode) {
        return this.validator.validate(data, mode);
    }
    async all(opts = {}) {
        const filter = this.buildBaseFilter(opts.filter);
        const sort = this.buildSort(opts);
        const { skip, limit, page } = this.buildPagination(opts);
        const projection = this.buildProjection(opts);
        const [rawData, total] = await Promise.all([
            this.model.find(filter, projection).sort(sort).skip(skip).limit(limit).lean(),
            this.model.countDocuments(filter),
        ]);
        const directives = (0, queryParser_1.extractAppendDirectives)(opts);
        let data = directives.length
            ? (await (0, AppendService_1.appendToMany)(rawData, directives))
            : rawData;
        // Schema-level population (auto-populate declared in entity options)
        if (this.options.populate?.length) {
            data = (await (0, PopulationMiddleware_1.applyPopulationToMany)(data, this.options.populate, opts));
        }
        // Lazy migrations
        if (this.migrationSvc.hasMigrations()) {
            data = (await this.migrationSvc.migrateMany(data));
        }
        return this.paginatedResult(data, total, page, limit);
    }
    async findById(id, opts = {}) {
        const filter = this.buildBaseFilter({ $or: [{ uuid: id }, { _id: id }] });
        const projection = this.buildProjection(opts);
        const doc = await this.model.findOne(filter, projection);
        if (!doc)
            return null;
        const directives = (0, queryParser_1.extractAppendDirectives)(opts);
        let plain = this.toPlain(doc);
        if (opts.includeChildren) {
            plain = await this.populateChildren(doc, opts);
        }
        if (directives.length) {
            plain = await (0, AppendService_1.appendToOne)(plain, directives);
        }
        // Schema-level population
        if (this.options.populate?.length) {
            plain = await (0, PopulationMiddleware_1.applyPopulationToOne)(plain, this.options.populate, opts);
        }
        // Lazy migration
        if (this.migrationSvc.hasMigrations()) {
            plain = await this.migrationSvc.migrateOne(plain);
        }
        return plain;
    }
    async findOne(filter, opts = {}) {
        const combined = this.buildBaseFilter(filter);
        const projection = this.buildProjection(opts);
        return this.model.findOne(combined, projection);
    }
    async findBy(field, value, opts = {}) {
        const filter = this.buildBaseFilter({ [field]: value, ...opts.filter });
        const sort = this.buildSort(opts);
        const { skip, limit, page } = this.buildPagination(opts);
        const projection = this.buildProjection(opts);
        const [rawData, total] = await Promise.all([
            this.model.find(filter, projection).sort(sort).skip(skip).limit(limit).lean(),
            this.model.countDocuments(filter),
        ]);
        const directives = (0, queryParser_1.extractAppendDirectives)(opts);
        let data = directives.length
            ? (await (0, AppendService_1.appendToMany)(rawData, directives))
            : rawData;
        if (this.options.populate?.length) {
            data = (await (0, PopulationMiddleware_1.applyPopulationToMany)(data, this.options.populate, opts));
        }
        if (this.migrationSvc.hasMigrations()) {
            data = (await this.migrationSvc.migrateMany(data));
        }
        return this.paginatedResult(data, total, page, limit);
    }
    async search(query, opts = {}) {
        const searchFields = opts.searchFields || this.options.searchableFields || [];
        const { skip, limit, page } = this.buildPagination(opts);
        const sort = this.buildSort(opts);
        let filter;
        if (searchFields.length > 0) {
            const regex = new RegExp(query, "i");
            filter = this.buildBaseFilter({
                $or: searchFields.map((f) => ({ [f]: regex })),
                ...opts.filter,
            });
        }
        else {
            filter = this.buildBaseFilter({ $text: { $search: query }, ...opts.filter });
        }
        const [rawData, total] = await Promise.all([
            this.model.find(filter).sort(sort).skip(skip).limit(limit).lean(),
            this.model.countDocuments(filter),
        ]);
        const directives = (0, queryParser_1.extractAppendDirectives)(opts);
        let data = directives.length
            ? (await (0, AppendService_1.appendToMany)(rawData, directives))
            : rawData;
        if (this.options.populate?.length) {
            data = (await (0, PopulationMiddleware_1.applyPopulationToMany)(data, this.options.populate, opts));
        }
        if (this.migrationSvc.hasMigrations()) {
            data = (await this.migrationSvc.migrateMany(data));
        }
        return this.paginatedResult(data, total, page, limit);
    }
    async create(data, opts = {}) {
        if (!opts.skipValidation) {
            const result = this.validator.validate(data, "create");
            if (!result.valid) {
                const err = new Error(result.errors.join("; "));
                err.name = "ValidationError";
                err.isJoi = true;
                err.details = result.errors;
                throw err;
            }
        }
        const payload = {
            ...data,
            uuid: (0, helpers_1.generateUUID)(),
        };
        if (data.title_name && !data.slug) {
            payload.slug = (0, helpers_1.generateSlug)(String(data.title_name));
        }
        const doc = await this.model.create(payload);
        if (!opts.skipEvents) {
            await this.events.emit("create", null, this.toPlain(doc), this.toPlain(doc));
        }
        return doc;
    }
    async createMany(data, opts = {}) {
        if (!opts.skipValidation) {
            for (let i = 0; i < data.length; i++) {
                const result = this.validator.validate(data[i], "create");
                if (!result.valid) {
                    const err = new Error(`Item ${i}: ${result.errors.join("; ")}`);
                    err.name = "ValidationError";
                    err.isJoi = true;
                    err.details = result.errors;
                    throw err;
                }
            }
        }
        const payloads = data.map((d) => {
            const p = { ...d, uuid: (0, helpers_1.generateUUID)() };
            if (d.title_name && !d.slug) {
                p.slug = (0, helpers_1.generateSlug)(String(d.title_name));
            }
            return p;
        });
        const docs = await this.model.insertMany(payloads);
        if (!opts.skipEvents) {
            for (const doc of docs) {
                await this.events.emit("create", null, this.toPlain(doc), this.toPlain(doc));
            }
        }
        return docs;
    }
    async update(id, data, opts = {}) {
        if (!opts.skipValidation) {
            const result = this.validator.validate(data, "update");
            if (!result.valid) {
                const err = new Error(result.errors.join("; "));
                err.name = "ValidationError";
                err.isJoi = true;
                err.details = result.errors;
                throw err;
            }
        }
        const existing = await this.model.findOne(this.buildBaseFilter({ $or: [{ uuid: id }, { _id: id }] }));
        if (!existing)
            return null;
        const before = this.toPlain(existing);
        if (data.title_name) {
            data.slug = (0, helpers_1.generateSlug)(String(data.title_name));
        }
        // Use doc.set() instead of Object.assign so Mongoose's internal change-tracking
        // picks up undeclared fields when strict:false is set on the schema.
        existing.set(data);
        await existing.save();
        const after = this.toPlain(existing);
        const diff = (0, helpers_1.deepDiff)(before, after);
        if (!opts.skipEvents) {
            await this.events.emit("update", diff.whatWas, diff.whatIs, after, diff);
            for (const changedKey of Object.keys(diff.whatIs)) {
                await this.events.emit(`update.${changedKey}`, diff.whatWas, diff.whatIs, after, diff);
            }
        }
        return existing;
    }
    async updateBy(filter, data, opts = {}) {
        if (!opts.skipValidation) {
            const result = this.validator.validate(data, "update");
            if (!result.valid) {
                const err = new Error(result.errors.join("; "));
                err.name = "ValidationError";
                err.isJoi = true;
                err.details = result.errors;
                throw err;
            }
        }
        const combined = this.buildBaseFilter(filter);
        const docs = await this.model.find(combined);
        const updated = [];
        for (const doc of docs) {
            const before = this.toPlain(doc);
            doc.set(data);
            await doc.save();
            const after = this.toPlain(doc);
            if (!opts.skipEvents) {
                const diff = (0, helpers_1.deepDiff)(before, after);
                await this.events.emit("update", diff.whatWas, diff.whatIs, after, diff);
                for (const changedKey of Object.keys(diff.whatIs)) {
                    await this.events.emit(`update.${changedKey}`, diff.whatWas, diff.whatIs, after, diff);
                }
            }
            updated.push(doc);
        }
        return updated;
    }
    async updateField(id, field, value, opts = {}) {
        return this.update(id, { [field]: value }, opts);
    }
    async delete(id, opts = {}) {
        const doc = await this.model.findOne(this.buildBaseFilter({ $or: [{ uuid: id }, { _id: id }] }));
        if (!doc)
            return false;
        const before = this.toPlain(doc);
        if (opts.soft !== false && this.options.softDelete !== false) {
            doc.deleted_at = new Date();
            doc.status = "archived";
            await doc.save();
        }
        else {
            await doc.deleteOne();
        }
        if (!opts.skipEvents) {
            await this.events.emit("delete", before, null, before);
        }
        return true;
    }
    async deleteBy(filter, opts = {}) {
        const combined = this.buildBaseFilter(filter);
        const docs = await this.model.find(combined);
        let count = 0;
        for (const doc of docs) {
            const before = this.toPlain(doc);
            if (opts.soft !== false && this.options.softDelete !== false) {
                doc.deleted_at = new Date();
                doc.status = "archived";
                await doc.save();
            }
            else {
                await doc.deleteOne();
            }
            if (!opts.skipEvents) {
                await this.events.emit("delete", before, null, before);
            }
            count++;
        }
        return count;
    }
    async restore(id) {
        const doc = await this.model.findOne({
            $or: [{ uuid: id }, { _id: id }],
        });
        if (!doc)
            return null;
        doc.deleted_at = null;
        doc.status = "active";
        await doc.save();
        await this.events.emit("restore", null, this.toPlain(doc), this.toPlain(doc));
        return doc;
    }
    async count(filter) {
        return this.model.countDocuments(this.buildBaseFilter(filter));
    }
    async exists(filter) {
        const count = await this.model.countDocuments(this.buildBaseFilter(filter));
        return count > 0;
    }
    async withChildren(id, opts = {}) {
        return this.findById(id, { ...opts, includeChildren: opts.includeChildren ?? true });
    }
    paginatedResult(data, total, page, limit) {
        const totalPages = Math.ceil(total / limit) || 1;
        return {
            data,
            pagination: {
                total,
                page,
                limit,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1,
            },
        };
    }
}
exports.MetaService = MetaService;
//# sourceMappingURL=MetaService.js.map