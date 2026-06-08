import { Request } from "express";
import { CustomRequest } from "./index";

// ─── 1. Schema-level population ───────────────────────────────────────────────

export interface PopulateConfig {
  /** Lazy ref to the source entity or model name string. */
  from: (() => import("./index").IMetaEntity<any>) | string;
  /** Field on this document whose value is the ID to look up. */
  localField: string;
  /** Key under which the populated document appears on the result. Defaults to lowercased collection name. */
  as?: string;
  /**
   * When true the population only runs when explicitly requested via ?populate=alias
   * or service option populate:[alias]. When false (default) it runs on every fetch.
   */
  optional?: boolean;
}

// ─── 2. Field-level access control ───────────────────────────────────────────

export type FieldPolicyGuard = (req: CustomRequest) => boolean | Promise<boolean>;

export interface FieldPolicy {
  /**
   * Guard for reading this field. When it returns false the field is stripped
   * from every response that passes through the controller or scopedService.
   */
  read?: FieldPolicyGuard;
  /**
   * Guard for writing this field. When it returns false the field is silently
   * dropped from create/update payloads before they reach the database.
   * To throw instead of silently drop, set strict: true.
   */
  write?: FieldPolicyGuard;
  /**
   * When true a failed write guard throws 403 instead of silently dropping.
   * Defaults to false.
   */
  strict?: boolean;
}

export type FieldPolicyMap = Record<string, FieldPolicy>;

// ─── 3. Audit log ────────────────────────────────────────────────────────────

export interface AuditLogOptions {
  /** Enable audit logging. */
  enabled: boolean;
  /**
   * Override the collection name for audit records.
   * Defaults to {entityName}_history.
   */
  collection?: string;
  /**
   * Which events to log. Defaults to ["create", "update", "delete"].
   */
  events?: Array<"create" | "update" | "delete" | "restore">;
  /**
   * Field on the document or request that identifies the actor.
   * Defaults to "updated_by" on the document, then "created_by".
   */
  actorField?: string;
}

export interface AuditRecord {
  entityName: string;
  entityId: string;
  event: string;
  actorId?: string;
  whatWas: Record<string, unknown> | null;
  whatIs: Record<string, unknown> | null;
  changedFields: string[];
  timestamp: Date;
}

// ─── 4. Virtuals ─────────────────────────────────────────────────────────────

export interface VirtualDefinition {
  get: (this: any) => unknown;
  set?: (this: any, value: unknown) => void;
}

export type VirtualMap = Record<string, VirtualDefinition | (() => unknown)>;

// ─── 5. Request-scoped service ────────────────────────────────────────────────

export interface ScopedServiceOptions {
  /**
   * Field on req.user (or req itself) that holds the caller's UUID.
   * Defaults to "uuid", then "id", then "_id".
   */
  userIdField?: string;
  /**
   * Field on req that contains the user object.
   * Defaults to "user".
   */
  userField?: string;
}

// ─── 6. Schema migrations ────────────────────────────────────────────────────

export interface MigrationDefinition {
  /** Schema version this migration targets. Use incrementing integers: 1, 2, 3... */
  version: number;
  /**
   * Transform applied to each document on read when its __schemaVersion is
   * less than this migration's version. Should return the transformed document.
   * Mutate the doc in place or return a new object — both work.
   */
  up: (doc: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /**
   * Human-readable description shown in migration logs.
   */
  description?: string;
}

// ─── 7. Webhooks ─────────────────────────────────────────────────────────────

export interface WebhookConfig {
  /** Event patterns to deliver. Same syntax as trigger(). */
  events: string[];
  /** Target URL for the POST request. */
  url: string;
  /**
   * Optional HMAC secret. When set, each delivery includes an
   * X-MetaManager-Signature header: sha256=<hmac-hex>.
   */
  secret?: string;
  /**
   * Request timeout in milliseconds. Defaults to 5000.
   */
  timeout?: number;
  /**
   * Number of retry attempts on non-2xx or network error. Defaults to 2.
   */
  retries?: number;
  /**
   * Optional static headers merged into every delivery.
   */
  headers?: Record<string, string>;
}

// ─── 8. Response serialiser ───────────────────────────────────────────────────

export type SerialiserFn<T = Record<string, unknown>> = (
  doc: T,
  req?: CustomRequest
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export interface SerialiserOptions<T = Record<string, unknown>> {
  /**
   * Transform applied to every document before it leaves the controller.
   * Runs after field policy stripping.
   */
  transform: SerialiserFn<T>;
}
