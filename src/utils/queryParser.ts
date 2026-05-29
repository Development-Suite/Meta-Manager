import { QueryOptions, PaginationOptions } from "../types";

export function parseQueryOptions(query: Record<string, unknown>): QueryOptions {
  const opts: QueryOptions = {};

  // Pagination
  if (query.page !== undefined) opts.page = parseInt(String(query.page), 10) || 1;
  if (query.limit !== undefined) opts.limit = parseInt(String(query.limit), 10) || 20;
  if (query.sort !== undefined) opts.sort = String(query.sort);
  if (query.order !== undefined) {
    const o = String(query.order).toLowerCase();
    opts.order = o === "asc" || o === "desc" ? o : "desc";
  }

  // Field projection
  if (query.fields !== undefined) {
    opts.fields = String(query.fields)
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
  }

  // Search
  if (query.search !== undefined) opts.search = String(query.search);
  if (query.searchFields !== undefined) {
    opts.searchFields = String(query.searchFields)
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
  }

  // Populate / relations
  if (query.populate !== undefined) {
    opts.populate = String(query.populate)
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
  }

  // Children
  if (query.includeChildren !== undefined) {
    const ic = String(query.includeChildren);
    if (ic === "true" || ic === "1") {
      opts.includeChildren = true;
    } else if (ic === "false" || ic === "0") {
      opts.includeChildren = false;
    } else {
      opts.includeChildren = ic.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  if (query.childDepth !== undefined) {
    opts.childDepth = parseInt(String(query.childDepth), 10) || 1;
  }

  // Child-specific pagination: childPage[books]=2&childLimit[books]=5
  const childPagination: Record<string, PaginationOptions> = {};
  for (const key of Object.keys(query)) {
    const pageMatch = key.match(/^childPage\[(.+)\]$/);
    const limitMatch = key.match(/^childLimit\[(.+)\]$/);
    const sortMatch = key.match(/^childSort\[(.+)\]$/);
    const orderMatch = key.match(/^childOrder\[(.+)\]$/);

    if (pageMatch) {
      const child = pageMatch[1];
      childPagination[child] = childPagination[child] || {};
      childPagination[child].page = parseInt(String(query[key]), 10) || 1;
    }
    if (limitMatch) {
      const child = limitMatch[1];
      childPagination[child] = childPagination[child] || {};
      childPagination[child].limit = parseInt(String(query[key]), 10) || 20;
    }
    if (sortMatch) {
      const child = sortMatch[1];
      childPagination[child] = childPagination[child] || {};
      childPagination[child].sort = String(query[key]);
    }
    if (orderMatch) {
      const child = orderMatch[1];
      childPagination[child] = childPagination[child] || {};
      const o = String(query[key]).toLowerCase();
      childPagination[child].order = o === "asc" || o === "desc" ? o : "desc";
    }
  }

  if (Object.keys(childPagination).length > 0) {
    opts.childPagination = childPagination;
  }

  // Append directives: append=customer-customerId or append[]=...
  if (query.append !== undefined) {
    opts.append = Array.isArray(query.append)
      ? (query.append as string[])
      : String(query.append);
  }

  // Arbitrary filter: filter[status]=active&filter[owned_by]=uuid
  const filter: Record<string, unknown> = {};
  for (const key of Object.keys(query)) {
    const match = key.match(/^filter\[(.+)\]$/);
    if (match) {
      filter[match[1]] = query[key];
    }
  }
  if (Object.keys(filter).length > 0) {
    opts.filter = filter;
  }

  return opts;
}

export function buildFieldProjection(fields: string | string[] | undefined): Record<string, 1> | undefined {
  if (!fields) return undefined;
  const arr = Array.isArray(fields) ? fields : fields.split(",").map((f) => f.trim());
  if (arr.length === 0) return undefined;
  return arr.reduce<Record<string, 1>>((acc, f) => {
    acc[f] = 1;
    return acc;
  }, {});
}

export function buildSortObject(
  sort: string | undefined,
  order: "asc" | "desc" | undefined,
  defaultSort: string,
  defaultOrder: "asc" | "desc"
): Record<string, 1 | -1> {
  const s = sort || defaultSort;
  const o = order || defaultOrder;
  return { [s]: o === "asc" ? 1 : -1 };
}



import { parseAppendParam, AppendDirective } from "../core/AppendService";

export function extractAppendDirectives(opts: import("../types").QueryOptions): AppendDirective[] {
  if (!opts.append) return [];
  return parseAppendParam(opts.append);
}
