import { Request, Response, NextFunction } from "express";
import { Document, Model } from "mongoose";
import Joi from "joi";
export interface CustomRequest extends Request {
    id?: string;
}
export interface CustomResponse extends Response {
}
export interface ResponseFormat {
    [key: string]: [number, string, boolean];
}
export type FieldDefinition = {
    type: unknown;
    required?: boolean;
    default?: unknown;
    unique?: boolean;
    index?: boolean;
    enum?: unknown[];
    ref?: string;
    [key: string]: unknown;
};
export type SchemaFields = Record<string, FieldDefinition | unknown>;
export type JoiSchemaMap = Record<string, Joi.Schema>;
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
export type RelationType = "parent" | "sister";
export interface RelationConfig {
    entity: () => IMetaEntity<any>;
    type: RelationType;
    foreignKey: string;
    localKey?: string;
}
export interface ChildEntityConfig {
    entity: () => IMetaEntity<any>;
    foreignKey: string;
    alias?: string;
}
export interface PaginationOptions {
    page?: number;
    limit?: number;
    sort?: string;
    order?: "asc" | "desc";
}
export interface PaginatedResult<T = unknown> {
    data: T[];
    pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasNext: boolean;
        hasPrev: boolean;
    };
}
export interface QueryOptions extends PaginationOptions {
    fields?: string | string[];
    filter?: Record<string, unknown>;
    search?: string;
    searchFields?: string[];
    populate?: string | string[];
    includeChildren?: boolean | string[];
    childDepth?: number;
    childPagination?: Record<string, PaginationOptions>;
}
export interface CreateOptions {
    skipEvents?: boolean;
    skipValidation?: boolean;
}
export interface UpdateOptions {
    skipEvents?: boolean;
    skipValidation?: boolean;
    upsert?: boolean;
}
export interface DeleteOptions {
    soft?: boolean;
    skipEvents?: boolean;
}
type Primitive = string | number | boolean | null | undefined | Date;
type StringValuedKeys<T> = {
    [K in keyof T]: T[K] extends string ? K : never;
}[keyof T];
type Prev = [never, 0, 1, 2, 3];
type DotPaths<T, Depth extends number = 2> = Depth extends 0 ? never : T extends Primitive ? never : T extends (infer Item)[] ? "[*]" | (Item extends Record<string, unknown> ? `[${string & StringValuedKeys<Item>}].${string}` : never) : {
    [K in keyof T & string]: K | (T[K] extends Primitive ? never : `${K}.${string & DotPaths<T[K], Prev[Depth]>}`);
}[keyof T & string];
type UpdatePaths<T> = DotPaths<Omit<T, keyof Document>, 2>;
export type EventPath<T = Record<string, unknown>> = "create" | "update" | "delete" | "restore" | `update.${string & UpdatePaths<T>}`;
export type EventType = string;
/**
 * Callback for "update" and "update.*" events.
 * Both whatWas and whatIs are guaranteed non-null — an update always has a
 * before state and an after state. They are Partial<T> because only the
 * changed fields are present in the diff object, not the full document.
 */
export type UpdateEventCallback<T = Record<string, unknown>> = (whatWas: Partial<T>, whatIs: Partial<T>, entity: T) => void | Promise<void>;
/**
 * Callback for "create" events.
 * whatWas is null (nothing existed before). whatIs is null (unused for create).
 * The full created document is in entity.
 */
export type CreateEventCallback<T = Record<string, unknown>> = (whatWas: null, whatIs: null, entity: T) => void | Promise<void>;
/**
 * Callback for "delete" events.
 * whatIs is null (nothing exists after deletion). whatWas carries the last state.
 */
export type DeleteEventCallback<T = Record<string, unknown>> = (whatWas: Partial<T>, whatIs: null, entity: T) => void | Promise<void>;
/**
 * Callback for "restore" events.
 * whatWas is null. The restored document is in entity.
 */
export type RestoreEventCallback<T = Record<string, unknown>> = (whatWas: null, whatIs: null, entity: T) => void | Promise<void>;
/**
 * Generic fallback used internally and for JS consumers.
 * Preserves the nullable union when the event category cannot be inferred statically.
 */
export type EventCallback<T = Record<string, unknown>> = (whatWas: Partial<T> | null, whatIs: Partial<T> | null, entity: T) => void | Promise<void>;
/**
 * Resolves the correctly-typed callback for a given event path string E.
 *
 *   "create"          -> CreateEventCallback<T>   (whatWas: null, whatIs: null)
 *   "delete"          -> DeleteEventCallback<T>   (whatWas: Partial<T>, whatIs: null)
 *   "restore"         -> RestoreEventCallback<T>  (whatWas: null, whatIs: null)
 *   "update"          -> UpdateEventCallback<T>   (whatWas: Partial<T>, whatIs: Partial<T>)
 *   "update.field"    -> UpdateEventCallback<T>   (whatWas: Partial<T>, whatIs: Partial<T>)
 *   "update.arr[*]"   -> UpdateEventCallback<T>   (whatWas: Partial<T>, whatIs: Partial<T>)
 */
export type CallbackForEvent<T, E extends string> = E extends "create" ? CreateEventCallback<T> : E extends "delete" ? DeleteEventCallback<T> : E extends "restore" ? RestoreEventCallback<T> : E extends "update" | `update.${string}` ? UpdateEventCallback<T> : EventCallback<T>;
export interface EventSubscription {
    types: string[];
    callback: EventCallback<any>;
}
/**
 * Broad action types. Can be narrowed to a specific field path for update
 * operations using the "update.fieldName" syntax, e.g.:
 *   "update.provider_id"
 *   "update.status"
 *   "update.personal_information.email"
 *
 * Broad actions:
 *   "create"  - fires on any create
 *   "read"    - fires on any read
 *   "update"  - fires on any update (all fields)
 *   "delete"  - fires on any delete
 *   "all"     - fires on every action
 *
 * Field-targeted update actions:
 *   "update.fieldName" - fires only when req contains that field
 */
export type InterceptorAction = "create" | "read" | "update" | "delete" | "all" | `update.${string}`;
export type InterceptorCallback = (req: CustomRequest, res: CustomResponse, next: NextFunction) => void | Promise<void>;
export interface InterceptorConfig {
    action: InterceptorAction | InterceptorAction[];
    callback: InterceptorCallback;
}
/**
 * Resolves the intended field paths from a request for field-targeted
 * interceptor matching.
 *
 * Sources per route type:
 *   PUT/PATCH /:id              -> keys of req.body
 *   PATCH /:id/field/:field     -> req.params.field
 *   PATCH /:id/nested           -> req.body.field
 *   PATCH /:id/nested/batch     -> req.body[].field (each op)
 */
export declare function resolveIntendedFields(req: CustomRequest): string[];
export interface MetaEntityOptions {
    additionalFields?: SchemaFields;
    /**
     * Joi schema map for fields accepted on create.
     * Base fields (uuid, created_at, slug, etc.) are excluded automatically.
     * Example: { title_name: Joi.string().required(), pageCount: Joi.number().min(0) }
     */
    createSchema?: JoiSchemaMap;
    /**
     * Joi schema map for fields accepted on update.
     * If omitted, defaults to createSchema with all keys set to optional.
     */
    updateSchema?: JoiSchemaMap;
    createValidationOptions?: Joi.ValidationOptions;
    updateValidationOptions?: Joi.ValidationOptions;
    timestamps?: boolean;
    softDelete?: boolean;
    searchableFields?: string[];
    defaultSort?: string;
    defaultOrder?: "asc" | "desc";
    defaultLimit?: number;
    parents?: RelationConfig[];
    sisters?: RelationConfig[];
    children?: ChildEntityConfig[];
    collectionName?: string;
    strictPopulate?: boolean;
}
export interface BaseEntityDocument extends Document {
    uuid: string;
    request_id?: string;
    meta_key?: string;
    meta_value?: string;
    data_type?: string | null;
    title_name?: string;
    description?: string;
    entity_featured_url?: string;
    extra_data?: unknown[];
    meta_data?: unknown[];
    status: "active" | "inactive" | "archived";
    parent_entity_type?: string | null;
    parent_entity?: string | null;
    owned_by?: string | null;
    added_by?: string | null;
    created_by?: string | null;
    updated_by?: string | null;
    slug?: string;
    deleted_at?: Date | null;
    [key: string]: unknown;
}
export interface IMetaService<T extends BaseEntityDocument = BaseEntityDocument> {
    all(options?: QueryOptions): Promise<PaginatedResult<T>>;
    findById(id: string, options?: QueryOptions): Promise<T | null>;
    findOne(filter: Record<string, unknown>, options?: QueryOptions): Promise<T | null>;
    findBy(field: string, value: unknown, options?: QueryOptions): Promise<PaginatedResult<T>>;
    search(query: string, options?: QueryOptions): Promise<PaginatedResult<T>>;
    create(data: Partial<T>, options?: CreateOptions): Promise<T>;
    createMany(data: Partial<T>[], options?: CreateOptions): Promise<T[]>;
    update(id: string, data: Partial<T>, options?: UpdateOptions): Promise<T | null>;
    updateBy(filter: Record<string, unknown>, data: Partial<T>, options?: UpdateOptions): Promise<T[]>;
    updateField(id: string, field: string, value: unknown, options?: UpdateOptions): Promise<T | null>;
    delete(id: string, options?: DeleteOptions): Promise<boolean>;
    deleteBy(filter: Record<string, unknown>, options?: DeleteOptions): Promise<number>;
    restore(id: string): Promise<T | null>;
    count(filter?: Record<string, unknown>): Promise<number>;
    exists(filter: Record<string, unknown>): Promise<boolean>;
    withChildren(id: string, options?: QueryOptions): Promise<T | null>;
    validate(data: unknown, mode: "create" | "update"): ValidationResult;
}
export interface IMetaEntity<T extends BaseEntityDocument = BaseEntityDocument> {
    readonly entityName: string;
    readonly model: Model<T>;
    readonly service: IMetaService<T>;
    readonly controller: import("express").Router;
    /**
     * Subscribe to entity lifecycle events.
     *
     * TypeScript resolves the callback signature automatically based on the event string:
     *   "create"       -> (null, null, entity)
     *   "delete"       -> (whatWas, null, entity)
     *   "restore"      -> (null, null, entity)
     *   "update"       -> (whatWas, whatIs, entity)  -- both guaranteed non-null
     *   "update.field" -> (whatWas, whatIs, entity)  -- both guaranteed non-null
     */
    trigger<E extends EventPath<T>>(events: E[], callback: CallbackForEvent<T, E>): void;
    intercept(action: InterceptorAction | InterceptorAction[], callback: InterceptorCallback): void;
}
export {};
//# sourceMappingURL=index.d.ts.map