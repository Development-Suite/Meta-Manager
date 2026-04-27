"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateUUID = generateUUID;
exports.generateSlug = generateSlug;
exports.resolvePath = resolvePath;
exports.deepDiff = deepDiff;
exports.eventMatches = eventMatches;
const uuid_1 = require("uuid");
function generateUUID() {
    return (0, uuid_1.v4)();
}
function generateSlug(value) {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/[\s_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
/**
 * Resolve a dot-path string against a nested object.
 * e.g. resolvePath(obj, "extra_data[0].tokenName")
 */
function resolvePath(obj, path) {
    const parts = path
        .replace(/\[(\d+)\]/g, ".$1")
        .split(".")
        .filter(Boolean);
    return parts.reduce((current, part) => {
        if (current === null || current === undefined)
            return undefined;
        return current[part];
    }, obj);
}
/**
 * Deep diff between two objects. Returns only changed keys with their before/after values.
 */
function deepDiff(before, after) {
    const whatWas = {};
    const whatIs = {};
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of allKeys) {
        const bVal = JSON.stringify(before[key]);
        const aVal = JSON.stringify(after[key]);
        if (bVal !== aVal) {
            whatWas[key] = before[key];
            whatIs[key] = after[key];
        }
    }
    return { whatWas, whatIs };
}
/**
 * Check if a subscription pattern matches a triggered event.
 *
 * Supported patterns:
 *   "create"                              exact match
 *   "update"                              matches "update" and "update.*"
 *   "update.fieldName"                    specific field
 *   "update.extra_data[*]"               any element in the array changed
 *   "update.extra_data[tokenName].Zugacoin"  specific named array element
 */
function eventMatches(pattern, eventType, diff) {
    if (pattern === eventType)
        return true;
    if (eventType.startsWith(pattern + "."))
        return true;
    if (pattern.includes("[*]") && diff) {
        const basePath = pattern.replace(/\[\*\].*$/, "").replace(/^update\./, "");
        const changedArr = diff.whatIs[basePath];
        if (Array.isArray(changedArr))
            return true;
    }
    const arrayItemPattern = /^update\.(.+?)\[(.+?)\]\.(.+)$/.exec(pattern);
    if (arrayItemPattern && diff) {
        const [, fieldPath, keyField, keyValue] = arrayItemPattern;
        const afterArr = diff.whatIs[fieldPath];
        const beforeArr = diff.whatWas[fieldPath];
        if (Array.isArray(afterArr) || Array.isArray(beforeArr)) {
            const arr = (Array.isArray(afterArr) ? afterArr : beforeArr);
            return arr.some((item) => item && String(item[keyField]) === keyValue);
        }
    }
    return false;
}
//# sourceMappingURL=helpers.js.map