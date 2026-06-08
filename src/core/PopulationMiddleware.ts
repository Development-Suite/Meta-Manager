import { PopulateConfig } from "../types/features";
import { appendToOne, appendToMany, AppendDirective } from "./AppendService";
import { QueryOptions } from "../types";

function resolveAlias(cfg: PopulateConfig): string {
  if (cfg.as) return cfg.as;
  const source = cfg.from;
  if (typeof source === "string") return source.toLowerCase();
  try {
    const entity = source();
    return entity.entityName.toLowerCase();
  } catch {
    return "populated";
  }
}

function resolveCollectionName(cfg: PopulateConfig): string {
  const source = cfg.from;
  if (typeof source === "string") return source;
  try {
    return source().entityName;
  } catch {
    return "unknown";
  }
}

function configToDirective(cfg: PopulateConfig): AppendDirective {
  return {
    collection: resolveCollectionName(cfg),
    localField:  cfg.localField,
    resultKey:   resolveAlias(cfg),
  };
}

/**
 * Resolve which populate configs should run for a given request/service call.
 *
 * - Non-optional configs always run.
 * - Optional configs only run when their alias appears in opts.populate.
 */
export function resolvePopulateDirectives(
  configs: PopulateConfig[],
  opts?: QueryOptions
): AppendDirective[] {
  const requestedAliases = opts?.populate
    ? (Array.isArray(opts.populate) ? opts.populate : [opts.populate])
    : [];

  return configs
    .filter((cfg) => {
      if (!cfg.optional) return true;
      const alias = resolveAlias(cfg);
      return requestedAliases.includes(alias);
    })
    .map(configToDirective);
}

export async function applyPopulationToOne(
  doc: Record<string, unknown>,
  configs: PopulateConfig[],
  opts?: QueryOptions
): Promise<Record<string, unknown>> {
  const directives = resolvePopulateDirectives(configs, opts);
  if (directives.length === 0) return doc;
  return appendToOne(doc, directives);
}

export async function applyPopulationToMany(
  docs: Record<string, unknown>[],
  configs: PopulateConfig[],
  opts?: QueryOptions
): Promise<Record<string, unknown>[]> {
  const directives = resolvePopulateDirectives(configs, opts);
  if (directives.length === 0) return docs;
  return appendToMany(docs, directives);
}
