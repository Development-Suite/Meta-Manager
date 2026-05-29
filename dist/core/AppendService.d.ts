/**
 * Parsed from a single append directive string.
 *
 * Format: "collectionName-localField"
 * e.g.   "customer-customerId"   -> look in 'customer' collection, match on doc.customerId
 *        "owner-ownerId"         -> look in 'owner' collection, match on doc.ownerId
 *        "library"               -> look in 'library' collection, match on doc.libraryId (default: collectionName + "Id")
 */
export interface AppendDirective {
    /** The collection/model name to look up in. Case-insensitive match against mongoose.models. */
    collection: string;
    /** The field on the source document whose value is the ID to match. */
    localField: string;
    /** The key under which the found document is placed on the result. Defaults to collection name. */
    resultKey: string;
}
export declare function parseAppendParam(raw: string | string[]): AppendDirective[];
/**
 * Populate append directives onto a single document object.
 * Returns a new plain object with the appended keys merged in.
 */
export declare function appendToOne(doc: Record<string, unknown>, directives: AppendDirective[]): Promise<Record<string, unknown>>;
/**
 * Populate append directives onto a list of documents.
 * Uses a single $in query per directive to avoid N+1.
 */
export declare function appendToMany(docs: Record<string, unknown>[], directives: AppendDirective[]): Promise<Record<string, unknown>[]>;
//# sourceMappingURL=AppendService.d.ts.map