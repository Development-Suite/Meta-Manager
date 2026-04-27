import { Request, Response, NextFunction } from "express";
import { Document, Model } from "mongoose";
import Joi from "joi";

// Request / Response

export interface CustomRequest extends Request {
  id?: string;
}
export interface CustomResponse extends Response {}

export interface ResponseFormat {
  [key: string]: [number, string, boolean];
}

// Field Definitions

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

// Validation

export type JoiSchemaMap = Record<string, Joi.Schema>;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Relation Config

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

// Pagination

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

// Query Options

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

// Service Options

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

// Event path deep inference
//
// Given document type T, EventPath<T> produces a union of all valid event
// strings including typed dot-paths under "update.*".
//
// e.g. for { title_name: string; extra_data: { tokenName: string }[] }:
//   "create" | "update" | "delete" | "restore"
//   "update.title_name" | "update.extra_data"
//   "update.extra_data[*]"
//   "update.extra_data[tokenName].Zugacoin"

type Primitive = string | number | boolean | null | undefined | Date;

type StringValuedKeys<T> = {
  [K in keyof T]: T[K] extends string ? K : never;
}[keyof T];

type Prev = [never, 0, 1, 2, 3];

type DotPaths<T, Depth extends number = 2> = Depth extends 0
  ? never
  : T extends Primitive
  ? never
  : T extends (infer Item)[]
  ?
      | "[*]"
      | (Item extends Record<string, unknown>
          ? `[${string & StringValuedKeys<Item>}].${string}`
          : never)
  : {
      [K in keyof T & string]:
        | K
        | (T[K] extends Primitive
            ? never
            : `${K}.${string & DotPaths<T[K], Prev[Depth]>}`);
    }[keyof T & string];

type UpdatePaths<T> = DotPaths<Omit<T, keyof Document>, 2>;

export type EventPath<T = Record<string, unknown>> =
  | "create"
  | "update"
  | "delete"
  | "restore"
  | `update.${string & UpdatePaths<T>}`;

export type EventType = string;

export type EventCallback<T = Record<string, unknown>> = (
  whatWas: Partial<T> | null,
  whatIs: Partial<T> | null,
  entity: T
) => void | Promise<void>;

export interface EventSubscription {
  types: string[];
  callback: EventCallback<any>;
}

// Interceptor System

export type InterceptorAction =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "all";

export type InterceptorCallback = (
  req: CustomRequest,
  res: CustomResponse,
  next: NextFunction
) => void | Promise<void>;

export interface InterceptorConfig {
  action: InterceptorAction | InterceptorAction[];
  callback: InterceptorCallback;
}

// Entity Options

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

// Document shape

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

// Service Interface

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

// MetaEntity Interface

export interface IMetaEntity<T extends BaseEntityDocument = BaseEntityDocument> {
  readonly entityName: string;
  readonly model: Model<T>;
  readonly service: IMetaService<T>;
  readonly controller: import("express").Router;
  trigger(events: EventPath<T>[], callback: EventCallback<T>): void;
  intercept(
    action: InterceptorAction | InterceptorAction[],
    callback: InterceptorCallback
  ): void;
}
