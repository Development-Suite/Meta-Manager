import { Model, FilterQuery } from "mongoose";
import { BaseEntityDocument } from "../types";
import { NestedOpPayload, NestedOpResult, NestedOperation } from "../types/nestedOps";
import { MetaEventEmitter } from "./EventEmitter";
import { deepDiff } from "../utils/helpers";

export class NestedOpsService<T extends BaseEntityDocument = BaseEntityDocument> {
  constructor(
    private readonly model: Model<T>,
    private readonly events: MetaEventEmitter
  ) {}

  private buildIdFilter(id: string): FilterQuery<T> {
    return {
      deleted_at: null,
      $or: [{ uuid: id }, { _id: id }],
    } as FilterQuery<T>;
  }

  private toPlain(doc: T): Record<string, unknown> {
    return doc.toObject ? doc.toObject() : ({ ...doc } as unknown as Record<string, unknown>);
  }

  async apply(id: string, payload: NestedOpPayload): Promise<NestedOpResult<T>> {
    const { field, operation, value } = payload;

    const doc = await this.model.findOne(this.buildIdFilter(id));
    if (!doc) return { updated: null };

    const before = this.toPlain(doc);

    const { update, options } = this.buildUpdateQuery(field, operation, value);

    await this.model.updateOne(this.buildIdFilter(id), update, options);

    const updated = await this.model.findOne(this.buildIdFilter(id));
    if (!updated) return { updated: null };

    const after = this.toPlain(updated);
    const diff = deepDiff(before, after);

    await this.events.emit("update", diff.whatWas, diff.whatIs, after, diff);
    await this.events.emit(`update.${field}`, diff.whatWas, diff.whatIs, after, diff);

    return { updated };
  }

  async applyMany(id: string, payloads: NestedOpPayload[]): Promise<NestedOpResult<T>> {
    const doc = await this.model.findOne(this.buildIdFilter(id));
    if (!doc) return { updated: null };

    const before = this.toPlain(doc);

    // Group payloads that can be merged into one updateOne call.
    // patch_item uses arrayFilters so each gets its own call.
    const batch: NestedOpPayload[] = [];
    const isolated: NestedOpPayload[] = [];

    for (const p of payloads) {
      if (p.operation === "patch_item") {
        isolated.push(p);
      } else {
        batch.push(p);
      }
    }

    if (batch.length > 0) {
      const merged = this.mergeUpdateQueries(batch);
      await this.model.updateOne(this.buildIdFilter(id), merged);
    }

    for (const p of isolated) {
      const q = this.buildUpdateQuery(p.field, p.operation, p.value);
      await this.model.updateOne(
        this.buildIdFilter(id),
        q.update,
        q.options
      );
    }

    const updated = await this.model.findOne(this.buildIdFilter(id));
    if (!updated) return { updated: null };

    const after = this.toPlain(updated);
    const diff = deepDiff(before, after);

    await this.events.emit("update", diff.whatWas, diff.whatIs, after, diff);
    for (const changedKey of Object.keys(diff.whatIs)) {
      await this.events.emit(`update.${changedKey}`, diff.whatWas, diff.whatIs, after, diff);
    }

    return { updated };
  }

  private buildUpdateQuery(
    field: string,
    operation: NestedOperation,
    value: unknown
  ): any {
    switch (operation) {
      case "set":
        return { update: { $set: { [field]: value } }, options: {} };

      case "unset":
        return { update: { $unset: { [field]: "" } }, options: {} };

      case "push":
        return {
          update: { $push: { [field]: value } },
          options: {},
        };

      case "push_many": {
        const items = Array.isArray(value) ? value : [value];
        return {
          update: { $push: { [field]: { $each: items } } },
          options: {},
        };
      }

      case "pull":
        return {
          update: { $pull: { [field]: value } },
          options: {},
        };

      case "pull_id":
        return {
          update: { $pull: { [field]: { _mmid: value } } },
          options: {},
        };

      case "patch_item": {
        const { _mmid, ...fields } = value as Record<string, unknown>;
        if (!_mmid) {
          throw new Error("patch_item requires value._mmid to identify the target array element");
        }
        const setFields: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields)) {
          setFields[`${field}.$[elem].${k}`] = v;
        }
        return {
          update: { $set: setFields },
          options: { arrayFilters: [{ "elem._mmid": _mmid }], new: true },
        };
      }

      case "add_to_set":
        return {
          update: { $addToSet: { [field]: value } },
          options: {},
        };

      case "increment": {
        const n = typeof value === "number" ? value : Number(value);
        if (isNaN(n)) throw new Error("increment requires a numeric value");
        return {
          update: { $inc: { [field]: n } },
          options: {},
        };
      }

      case "rename":
        return {
          update: { $rename: { [field]: value } },
          options: {},
        };

      default:
        throw new Error(`Unknown nested operation: "${operation}"`);
    }
  }

  private mergeUpdateQueries(payloads: NestedOpPayload[]): any {
    const merged: Record<string, Record<string, unknown>> = {};

    for (const p of payloads) {
      const q = this.buildUpdateQuery(p.field, p.operation, p.value);
      const update = q.update as Record<string, Record<string, unknown>>;
      for (const [operator, fields] of Object.entries(update)) {
        if (!merged[operator]) merged[operator] = {};
        Object.assign(merged[operator], fields);
      }
    }

    return merged;
  }
}
