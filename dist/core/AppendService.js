"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAppendParam = parseAppendParam;
exports.appendToOne = appendToOne;
exports.appendToMany = appendToMany;
const mongoose_1 = __importDefault(require("mongoose"));
function parseAppendParam(raw) {
    const values = Array.isArray(raw) ? raw : [raw];
    const directives = [];
    for (const v of values) {
        // Each value may be a comma-separated list or a single directive
        const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
        for (const part of parts) {
            const directive = parseOne(part);
            if (directive)
                directives.push(directive);
        }
    }
    return directives;
}
function parseOne(raw) {
    // Format: "collectionName-localField"
    // The separator is the LAST hyphen, allowing collection names like "service-provider"
    const lastHyphen = raw.lastIndexOf("-");
    if (lastHyphen === -1) {
        const collection = raw.trim();
        if (!collection)
            return null;
        return {
            collection,
            localField: collection.toLowerCase() + "Id",
            resultKey: collection.toLowerCase(),
        };
    }
    const collection = raw.slice(0, lastHyphen).trim();
    const localField = raw.slice(lastHyphen + 1).trim();
    if (!collection || !localField)
        return null;
    return { collection, localField, resultKey: collection.toLowerCase() };
}
/**
 * Find the Mongoose model for a given collection name.
 * Tries exact match first, then case-insensitive, then singular/plural variants.
 */
function resolveModel(collection) {
    const models = mongoose_1.default.models;
    // Exact match
    if (models[collection])
        return models[collection];
    // Case-insensitive match
    const lower = collection.toLowerCase();
    for (const key of Object.keys(models)) {
        if (key.toLowerCase() === lower)
            return models[key];
    }
    // Try capitalised first letter
    const cap = collection.charAt(0).toUpperCase() + collection.slice(1);
    if (models[cap])
        return models[cap];
    // Try singular (strip trailing 's')
    if (lower.endsWith("s")) {
        const singular = lower.slice(0, -1);
        for (const key of Object.keys(models)) {
            if (key.toLowerCase() === singular)
                return models[key];
        }
        const singularCap = singular.charAt(0).toUpperCase() + singular.slice(1);
        if (models[singularCap])
            return models[singularCap];
    }
    return null;
}
/**
 * Populate append directives onto a single document object.
 * Returns a new plain object with the appended keys merged in.
 */
async function appendToOne(doc, directives) {
    if (!directives.length)
        return doc;
    const result = { ...doc };
    await Promise.all(directives.map(async (d) => {
        const model = resolveModel(d.collection);
        if (!model) {
            result[d.resultKey] = null;
            return;
        }
        const localValue = doc[d.localField];
        if (!localValue) {
            result[d.resultKey] = null;
            return;
        }
        const found = await model
            .findOne({
            $or: [{ uuid: localValue }, { _id: localValue }],
            deleted_at: null,
        })
            .lean()
            .catch(() => null);
        result[d.resultKey] = found ?? null;
    }));
    return result;
}
/**
 * Populate append directives onto a list of documents.
 * Uses a single $in query per directive to avoid N+1.
 */
async function appendToMany(docs, directives) {
    if (!directives.length || !docs.length)
        return docs;
    // For each directive, batch-fetch all related documents
    const lookups = new Map();
    await Promise.all(directives.map(async (d) => {
        const model = resolveModel(d.collection);
        if (!model) {
            lookups.set(d.resultKey, {});
            return;
        }
        // Collect all unique local field values across the docs
        const ids = [
            ...new Set(docs
                .map((doc) => doc[d.localField])
                .filter((v) => v !== null && v !== undefined)
                .map(String)),
        ];
        if (!ids.length) {
            lookups.set(d.resultKey, {});
            return;
        }
        // Fetch all related docs in one query
        const related = await model
            .find({
            $or: [{ uuid: { $in: ids } }, { _id: { $in: ids } }],
        })
            .lean()
            .catch(() => []);
        // Build a lookup map: id -> document
        const byId = {};
        for (const r of related) {
            if (r.uuid)
                byId[String(r.uuid)] = r;
            if (r._id)
                byId[String(r._id)] = r;
        }
        lookups.set(d.resultKey, byId);
    }));
    // Stitch the related documents onto each source doc
    return docs.map((doc) => {
        const result = { ...doc };
        for (const d of directives) {
            const byId = lookups.get(d.resultKey) || {};
            const localValue = String(doc[d.localField] ?? "");
            result[d.resultKey] = byId[localValue] ?? null;
        }
        return result;
    });
}
//# sourceMappingURL=AppendService.js.map