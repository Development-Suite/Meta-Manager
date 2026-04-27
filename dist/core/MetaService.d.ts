import { Model } from "mongoose";
import { BaseEntityDocument, IMetaService, QueryOptions, CreateOptions, UpdateOptions, DeleteOptions, PaginatedResult, MetaEntityOptions, ValidationResult } from "../types";
import { MetaEventEmitter } from "./EventEmitter";
export declare class MetaService<T extends BaseEntityDocument = BaseEntityDocument> implements IMetaService<T> {
    private readonly model;
    private readonly options;
    private readonly events;
    private readonly entityName;
    private readonly validator;
    constructor(model: Model<T>, options: MetaEntityOptions, events: MetaEventEmitter, entityName: string);
    private buildBaseFilter;
    private buildSort;
    private buildPagination;
    private buildProjection;
    private toPlain;
    private populateChildren;
    validate(data: unknown, mode: "create" | "update"): ValidationResult;
    all(opts?: QueryOptions): Promise<PaginatedResult<T>>;
    findById(id: string, opts?: QueryOptions): Promise<T | null>;
    findOne(filter: Record<string, unknown>, opts?: QueryOptions): Promise<T | null>;
    findBy(field: string, value: unknown, opts?: QueryOptions): Promise<PaginatedResult<T>>;
    search(query: string, opts?: QueryOptions): Promise<PaginatedResult<T>>;
    create(data: Partial<T>, opts?: CreateOptions): Promise<T>;
    createMany(data: Partial<T>[], opts?: CreateOptions): Promise<T[]>;
    update(id: string, data: Partial<T>, opts?: UpdateOptions): Promise<T | null>;
    updateBy(filter: Record<string, unknown>, data: Partial<T>, opts?: UpdateOptions): Promise<T[]>;
    updateField(id: string, field: string, value: unknown, opts?: UpdateOptions): Promise<T | null>;
    delete(id: string, opts?: DeleteOptions): Promise<boolean>;
    deleteBy(filter: Record<string, unknown>, opts?: DeleteOptions): Promise<number>;
    restore(id: string): Promise<T | null>;
    count(filter?: Record<string, unknown>): Promise<number>;
    exists(filter: Record<string, unknown>): Promise<boolean>;
    withChildren(id: string, opts?: QueryOptions): Promise<T | null>;
    private paginatedResult;
}
//# sourceMappingURL=MetaService.d.ts.map