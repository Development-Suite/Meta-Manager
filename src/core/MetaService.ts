import { Model, FilterQuery, ProjectionType } from "mongoose";
import {
  BaseEntityDocument,
  IMetaService,
  QueryOptions,
  CreateOptions,
  UpdateOptions,
  DeleteOptions,
  PaginatedResult,
  MetaEntityOptions,
  ChildEntityConfig,
  ValidationResult,
} from "../types";
import { appendToOne, appendToMany } from "./AppendService";
import { extractAppendDirectives } from "../utils/queryParser";
import { applyPopulationToOne, applyPopulationToMany } from "./PopulationMiddleware";
import { MigrationService } from "./MigrationService";
import { MetaEventEmitter } from "./EventEmitter";
import { MetaValidator } from "./MetaValidator";
import {
  generateUUID,
  generateSlug,
  deepDiff,
} from "../utils/helpers";
import { buildFieldProjection, buildSortObject } from "../utils/queryParser";

export class MetaService<T extends BaseEntityDocument = BaseEntityDocument>
  implements IMetaService<T>
{
  private readonly validator: MetaValidator;
  private readonly migrationSvc: MigrationService;

  constructor(
    private readonly model: Model<T>,
    private readonly options: MetaEntityOptions,
    private readonly events: MetaEventEmitter,
    private readonly entityName: string
  ) {
    this.validator    = new MetaValidator(options);
    this.migrationSvc = new MigrationService(options.migrations || []);
  }

  private buildBaseFilter(extra?: Record<string, unknown>): FilterQuery<T> {
    const f: Record<string, unknown> = { deleted_at: null };
    if (extra) Object.assign(f, extra);
    return f as FilterQuery<T>;
  }

  private buildSort(opts: QueryOptions): Record<string, 1 | -1> {
    return buildSortObject(
      opts.sort,
      opts.order,
      this.options.defaultSort || "created_at",
      this.options.defaultOrder || "desc"
    );
  }

  private buildPagination(opts: QueryOptions): { skip: number; limit: number; page: number } {
    const page = Math.max(1, opts.page || 1);
    const limit = Math.min(opts.limit || this.options.defaultLimit || 20, 500);
    return { skip: (page - 1) * limit, limit, page };
  }

  private buildProjection(opts: QueryOptions): ProjectionType<T> | undefined {
    return buildFieldProjection(opts.fields) as ProjectionType<T> | undefined;
  }

  private toPlain(doc: T): Record<string, unknown> {
    return doc.toObject ? doc.toObject() : ({ ...doc } as unknown as Record<string, unknown>);
  }

  private async populateChildren(doc: T, opts: QueryOptions): Promise<Record<string, unknown>> {
    const plain = this.toPlain(doc);
    const children = this.options.children || [];

    const include = opts.includeChildren;
    if (!include || children.length === 0) return plain;

    const targetChildren: ChildEntityConfig[] =
      include === true
        ? children
        : children.filter((c) => {
            const alias = c.alias || c.entity().entityName;
            return (include as string[]).includes(alias);
          });

    const depth = opts.childDepth ?? 1;

    for (const childConfig of targetChildren) {
      const childEntity = childConfig.entity();
      const alias = childConfig.alias || childEntity.entityName;
      const childPag = opts.childPagination?.[alias] || {};

      const childOpts: QueryOptions = {
        page: childPag.page || 1,
        limit: childPag.limit || this.options.defaultLimit || 20,
        sort: childPag.sort,
        order: childPag.order,
        includeChildren: depth > 1 ? true : false,
        childDepth: depth - 1,
      };

      const result = await childEntity.service.findBy(
        childConfig.foreignKey,
        plain.uuid || (plain as any)._id?.toString(),
        childOpts
      );

      // When depth > 1, recursively populate grandchildren on each result item
      if (depth > 1 && (childEntity as any).options?.children?.length > 0) {
        const deepItems = await Promise.all(
          result.data.map(async (item: any) => {
            const itemId = item.uuid || item._id?.toString();
            if (!itemId) return item;
            const deep = await childEntity.service.withChildren(itemId, {
              includeChildren: true,
              childDepth: depth - 1,
              childPagination: opts.childPagination,
            });
            return deep ?? item;
          })
        );
        plain[alias] = { ...result, data: deepItems };
      } else {
        plain[alias] = result;
      }
    }

    return plain;
  }

  validate(data: unknown, mode: "create" | "update"): ValidationResult {
    return this.validator.validate(data, mode);
  }

  async all(opts: QueryOptions = {}): Promise<PaginatedResult<T>> {
    const filter = this.buildBaseFilter(opts.filter);
    const sort = this.buildSort(opts);
    const { skip, limit, page } = this.buildPagination(opts);
    const projection = this.buildProjection(opts);

    const [rawData, total] = await Promise.all([
      this.model.find(filter, projection).sort(sort as any).skip(skip).limit(limit).lean() as Promise<T[]>,
      this.model.countDocuments(filter),
    ]);

    const directives = extractAppendDirectives(opts);
    let data: T[] = directives.length
      ? (await appendToMany(rawData as Record<string, unknown>[], directives)) as T[]
      : rawData;

    // Schema-level population (auto-populate declared in entity options)
    if (this.options.populate?.length) {
      data = (await applyPopulationToMany(data as unknown as Record<string, unknown>[], this.options.populate, opts)) as unknown as T[];
    }

    // Lazy migrations
    if (this.migrationSvc.hasMigrations()) {
      data = (await this.migrationSvc.migrateMany(data as unknown as Record<string, unknown>[])) as unknown as T[];
    }

    return this.paginatedResult(data, total, page, limit);
  }

  async findById(id: string, opts: QueryOptions = {}): Promise<T | null> {
    const filter = this.buildBaseFilter({ $or: [{ uuid: id }, { _id: id }] });
    const projection = this.buildProjection(opts);

    const doc = await this.model.findOne(filter, projection);
    if (!doc) return null;

    const directives = extractAppendDirectives(opts);

    let plain: Record<string, unknown> = this.toPlain(doc);

    if (opts.includeChildren) {
      plain = await this.populateChildren(doc, opts);
    }

    if (directives.length) {
      plain = await appendToOne(plain, directives);
    }

    // Schema-level population
    if (this.options.populate?.length) {
      plain = await applyPopulationToOne(plain, this.options.populate, opts);
    }

    // Lazy migration
    if (this.migrationSvc.hasMigrations()) {
      plain = await this.migrationSvc.migrateOne(plain);
    }

    return plain as unknown as T;
  }

  async findOne(filter: Record<string, unknown>, opts: QueryOptions = {}): Promise<T | null> {
    const combined = this.buildBaseFilter(filter);
    const projection = this.buildProjection(opts);
    return this.model.findOne(combined, projection);
  }

  async findBy(field: string, value: unknown, opts: QueryOptions = {}): Promise<PaginatedResult<T>> {
    const filter = this.buildBaseFilter({ [field]: value, ...opts.filter });
    const sort = this.buildSort(opts);
    const { skip, limit, page } = this.buildPagination(opts);
    const projection = this.buildProjection(opts);

    const [rawData, total] = await Promise.all([
      this.model.find(filter, projection).sort(sort as any).skip(skip).limit(limit).lean() as Promise<T[]>,
      this.model.countDocuments(filter),
    ]);

    const directives = extractAppendDirectives(opts);
    let data: T[] = directives.length
      ? (await appendToMany(rawData as Record<string, unknown>[], directives)) as T[]
      : rawData;

    if (this.options.populate?.length) {
      data = (await applyPopulationToMany(data as unknown as Record<string, unknown>[], this.options.populate, opts)) as unknown as T[];
    }

    if (this.migrationSvc.hasMigrations()) {
      data = (await this.migrationSvc.migrateMany(data as unknown as Record<string, unknown>[])) as unknown as T[];
    }

    return this.paginatedResult(data, total, page, limit);
  }

  async search(query: string, opts: QueryOptions = {}): Promise<PaginatedResult<T>> {
    const searchFields = opts.searchFields || this.options.searchableFields || [];
    const { skip, limit, page } = this.buildPagination(opts);
    const sort = this.buildSort(opts);

    let filter: FilterQuery<T>;

    if (searchFields.length > 0) {
      const regex = new RegExp(query, "i");
      filter = this.buildBaseFilter({
        $or: searchFields.map((f) => ({ [f]: regex })),
        ...opts.filter,
      });
    } else {
      filter = this.buildBaseFilter({ $text: { $search: query }, ...opts.filter });
    }

    const [rawData, total] = await Promise.all([
      this.model.find(filter).sort(sort as any).skip(skip).limit(limit).lean() as Promise<T[]>,
      this.model.countDocuments(filter),
    ]);

    const directives = extractAppendDirectives(opts);
    let data: T[] = directives.length
      ? (await appendToMany(rawData as Record<string, unknown>[], directives)) as T[]
      : rawData;

    if (this.options.populate?.length) {
      data = (await applyPopulationToMany(data as unknown as Record<string, unknown>[], this.options.populate, opts)) as unknown as T[];
    }

    if (this.migrationSvc.hasMigrations()) {
      data = (await this.migrationSvc.migrateMany(data as unknown as Record<string, unknown>[])) as unknown as T[];
    }

    return this.paginatedResult(data, total, page, limit);
  }

  async create(data: Partial<T>, opts: CreateOptions = {}): Promise<T> {
    if (!opts.skipValidation) {
      const result = this.validator.validate(data, "create");
      if (!result.valid) {
        const err = new Error(result.errors.join("; ")) as any;
        err.name = "ValidationError";
        err.isJoi = true;
        err.details = result.errors;
        throw err;
      }
    }

    const payload: Partial<T> & { uuid?: string } = {
      ...data,
      uuid: generateUUID(),
    };

    if ((data as any).title_name && !(data as any).slug) {
      (payload as any).slug = generateSlug(String((data as any).title_name));
    }

    const doc = await this.model.create(payload);

    if (!opts.skipEvents) {
      await this.events.emit("create", null, this.toPlain(doc), this.toPlain(doc));
    }

    return doc;
  }

  async createMany(data: Partial<T>[], opts: CreateOptions = {}): Promise<T[]> {
    if (!opts.skipValidation) {
      for (let i = 0; i < data.length; i++) {
        const result = this.validator.validate(data[i], "create");
        if (!result.valid) {
          const err = new Error(`Item ${i}: ${result.errors.join("; ")}`) as any;
          err.name = "ValidationError";
          err.isJoi = true;
          err.details = result.errors;
          throw err;
        }
      }
    }

    const payloads = data.map((d) => {
      const p: Partial<T> & { uuid?: string } = { ...d, uuid: generateUUID() };
      if ((d as any).title_name && !(d as any).slug) {
        (p as any).slug = generateSlug(String((d as any).title_name));
      }
      return p;
    });

    const docs = await this.model.insertMany(payloads as any[]) as unknown as T[];

    if (!opts.skipEvents) {
      for (const doc of docs) {
        await this.events.emit("create", null, this.toPlain(doc), this.toPlain(doc));
      }
    }

    return docs;
  }

  async update(id: string, data: Partial<T>, opts: UpdateOptions = {}): Promise<T | null> {
    if (!opts.skipValidation) {
      const result = this.validator.validate(data, "update");
      if (!result.valid) {
        const err = new Error(result.errors.join("; ")) as any;
        err.name = "ValidationError";
        err.isJoi = true;
        err.details = result.errors;
        throw err;
      }
    }

    const existing = await this.model.findOne(
      this.buildBaseFilter({ $or: [{ uuid: id }, { _id: id }] })
    );
    if (!existing) return null;

    const before = this.toPlain(existing);

    if ((data as any).title_name) {
      (data as any).slug = generateSlug(String((data as any).title_name));
    }

    // Use doc.set() instead of Object.assign so Mongoose's internal change-tracking
    // picks up undeclared fields when strict:false is set on the schema.
    existing.set(data);
    await existing.save();

    const after = this.toPlain(existing);
    const diff = deepDiff(before, after);

    if (!opts.skipEvents) {
      await this.events.emit("update", diff.whatWas, diff.whatIs, after, diff);
      for (const changedKey of Object.keys(diff.whatIs)) {
        await this.events.emit(`update.${changedKey}`, diff.whatWas, diff.whatIs, after, diff);
      }
    }

    return existing;
  }

  async updateBy(
    filter: Record<string, unknown>,
    data: Partial<T>,
    opts: UpdateOptions = {}
  ): Promise<T[]> {
    if (!opts.skipValidation) {
      const result = this.validator.validate(data, "update");
      if (!result.valid) {
        const err = new Error(result.errors.join("; ")) as any;
        err.name = "ValidationError";
        err.isJoi = true;
        err.details = result.errors;
        throw err;
      }
    }

    const combined = this.buildBaseFilter(filter);
    const docs = await this.model.find(combined);
    const updated: T[] = [];

    for (const doc of docs) {
      const before = this.toPlain(doc);
      doc.set(data);
      await doc.save();
      const after = this.toPlain(doc);

      if (!opts.skipEvents) {
        const diff = deepDiff(before, after);
        await this.events.emit("update", diff.whatWas, diff.whatIs, after, diff);
        for (const changedKey of Object.keys(diff.whatIs)) {
          await this.events.emit(`update.${changedKey}`, diff.whatWas, diff.whatIs, after, diff);
        }
      }

      updated.push(doc);
    }

    return updated;
  }

  async updateField(
    id: string,
    field: string,
    value: unknown,
    opts: UpdateOptions = {}
  ): Promise<T | null> {
    return this.update(id, { [field]: value } as Partial<T>, opts);
  }

  async delete(id: string, opts: DeleteOptions = {}): Promise<boolean> {
    const doc = await this.model.findOne(
      this.buildBaseFilter({ $or: [{ uuid: id }, { _id: id }] })
    );
    if (!doc) return false;

    const before = this.toPlain(doc);

    if (opts.soft !== false && this.options.softDelete !== false) {
      (doc as any).deleted_at = new Date();
      (doc as any).status = "archived";
      await doc.save();
    } else {
      await doc.deleteOne();
    }

    if (!opts.skipEvents) {
      await this.events.emit("delete", before, null, before);
    }

    return true;
  }

  async deleteBy(
    filter: Record<string, unknown>,
    opts: DeleteOptions = {}
  ): Promise<number> {
    const combined = this.buildBaseFilter(filter);
    const docs = await this.model.find(combined);
    let count = 0;

    for (const doc of docs) {
      const before = this.toPlain(doc);

      if (opts.soft !== false && this.options.softDelete !== false) {
        (doc as any).deleted_at = new Date();
        (doc as any).status = "archived";
        await doc.save();
      } else {
        await doc.deleteOne();
      }

      if (!opts.skipEvents) {
        await this.events.emit("delete", before, null, before);
      }

      count++;
    }

    return count;
  }

  async restore(id: string): Promise<T | null> {
    const doc = await this.model.findOne({
      $or: [{ uuid: id }, { _id: id }],
    });
    if (!doc) return null;

    (doc as any).deleted_at = null;
    (doc as any).status = "active";
    await doc.save();

    await this.events.emit("restore", null, this.toPlain(doc), this.toPlain(doc));
    return doc;
  }

  async count(filter?: Record<string, unknown>): Promise<number> {
    return this.model.countDocuments(this.buildBaseFilter(filter));
  }

  async exists(filter: Record<string, unknown>): Promise<boolean> {
    const count = await this.model.countDocuments(this.buildBaseFilter(filter));
    return count > 0;
  }

  async withChildren(id: string, opts: QueryOptions = {}): Promise<T | null> {
    return this.findById(id, { ...opts, includeChildren: opts.includeChildren ?? true });
  }

  private paginatedResult<D>(
    data: D[],
    total: number,
    page: number,
    limit: number
  ): PaginatedResult<D> {
    const totalPages = Math.ceil(total / limit) || 1;
    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }
}
