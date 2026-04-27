import { v4 as uuidv4 } from "uuid";

export function generateUUID(): string {
  return uuidv4();
}

export function generateSlug(value: string): string {
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
export function resolvePath(obj: unknown, path: string): unknown {
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);

  return parts.reduce<unknown>((current, part) => {
    if (current === null || current === undefined) return undefined;
    return (current as Record<string, unknown>)[part];
  }, obj);
}

/**
 * Deep diff between two objects. Returns only changed keys with their before/after values.
 */
export function deepDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): { whatWas: Record<string, unknown>; whatIs: Record<string, unknown> } {
  const whatWas: Record<string, unknown> = {};
  const whatIs: Record<string, unknown> = {};

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
export function eventMatches(
  pattern: string,
  eventType: string,
  diff?: { whatWas: Record<string, unknown>; whatIs: Record<string, unknown> }
): boolean {
  if (pattern === eventType) return true;

  if (eventType.startsWith(pattern + ".")) return true;

  if (pattern.includes("[*]") && diff) {
    const basePath = pattern.replace(/\[\*\].*$/, "").replace(/^update\./, "");
    const changedArr = diff.whatIs[basePath];
    if (Array.isArray(changedArr)) return true;
  }

  const arrayItemPattern = /^update\.(.+?)\[(.+?)\]\.(.+)$/.exec(pattern);
  if (arrayItemPattern && diff) {
    const [, fieldPath, keyField, keyValue] = arrayItemPattern;
    const afterArr = diff.whatIs[fieldPath];
    const beforeArr = diff.whatWas[fieldPath];
    if (Array.isArray(afterArr) || Array.isArray(beforeArr)) {
      const arr = (Array.isArray(afterArr) ? afterArr : beforeArr) as Record<string, unknown>[];
      return arr.some((item) => item && String(item[keyField]) === keyValue);
    }
  }

  return false;
}
