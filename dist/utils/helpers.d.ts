export declare function generateUUID(): string;
export declare function generateSlug(value: string): string;
/**
 * Resolve a dot-path string against a nested object.
 * e.g. resolvePath(obj, "extra_data[0].tokenName")
 */
export declare function resolvePath(obj: unknown, path: string): unknown;
/**
 * Deep diff between two objects. Returns only changed keys with their before/after values.
 */
export declare function deepDiff(before: Record<string, unknown>, after: Record<string, unknown>): {
    whatWas: Record<string, unknown>;
    whatIs: Record<string, unknown>;
};
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
export declare function eventMatches(pattern: string, eventType: string, diff?: {
    whatWas: Record<string, unknown>;
    whatIs: Record<string, unknown>;
}): boolean;
//# sourceMappingURL=helpers.d.ts.map