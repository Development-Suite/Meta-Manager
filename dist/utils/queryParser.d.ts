import { QueryOptions } from "../types";
export declare function parseQueryOptions(query: Record<string, unknown>): QueryOptions;
export declare function buildFieldProjection(fields: string | string[] | undefined): Record<string, 1> | undefined;
export declare function buildSortObject(sort: string | undefined, order: "asc" | "desc" | undefined, defaultSort: string, defaultOrder: "asc" | "desc"): Record<string, 1 | -1>;
//# sourceMappingURL=queryParser.d.ts.map