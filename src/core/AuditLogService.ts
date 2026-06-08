import mongoose from "mongoose";
import { MetaEventEmitter } from "./EventEmitter";
import { AuditLogOptions, AuditRecord } from "../types/features";

const AUDIT_SCHEMA = new mongoose.Schema(
  {
    entityName:    { type: String, required: true, index: true },
    entityId:      { type: String, required: true, index: true },
    event:         { type: String, required: true },
    actorId:       { type: String, default: null },
    whatWas:       { type: mongoose.Schema.Types.Mixed, default: null },
    whatIs:        { type: mongoose.Schema.Types.Mixed, default: null },
    changedFields: { type: [String], default: [] },
    timestamp:     { type: Date, default: Date.now, index: true },
  },
  { strict: false }
);

export class AuditLogService {
  private readonly collectionName: string;
  private readonly trackedEvents: string[];
  private readonly actorField: string;
  private auditModel: mongoose.Model<any> | null = null;

  constructor(
    private readonly entityName: string,
    private readonly events: MetaEventEmitter,
    options: AuditLogOptions
  ) {
    this.collectionName = options.collection || `${entityName.toLowerCase()}_history`;
    this.trackedEvents  = options.events || ["create", "update", "delete"];
    this.actorField     = options.actorField || "updated_by";

    this.init();
  }

  private init(): void {
    const modelName = `__audit_${this.entityName}`;

    this.auditModel =
      (mongoose.models[modelName] as mongoose.Model<any>) ||
      mongoose.model(modelName, AUDIT_SCHEMA, this.collectionName);

    const tracked = this.trackedEvents;

    // Subscribe to all tracked base events
    if (tracked.includes("create")) {
      this.events.on(["create"], async (_ww, _wi, entity) => {
        await this.write("create", null, entity as Record<string, unknown>, entity as Record<string, unknown>);
      });
    }

    if (tracked.includes("update")) {
      this.events.on(["update"], async (whatWas, whatIs, entity) => {
        await this.write("update", whatWas as Record<string, unknown>, whatIs as Record<string, unknown>, entity as Record<string, unknown>);
      });
    }

    if (tracked.includes("delete")) {
      this.events.on(["delete"], async (whatWas, _wi, entity) => {
        await this.write("delete", whatWas as Record<string, unknown>, null, entity as Record<string, unknown>);
      });
    }

    if (tracked.includes("restore")) {
      this.events.on(["restore"], async (_ww, _wi, entity) => {
        await this.write("restore", null, entity as Record<string, unknown>, entity as Record<string, unknown>);
      });
    }
  }

  private async write(
    event: string,
    whatWas: Record<string, unknown> | null,
    whatIs: Record<string, unknown> | null,
    entity: Record<string, unknown>
  ): Promise<void> {
    if (!this.auditModel) return;

    const changedFields = whatWas && whatIs ? Object.keys(whatIs) : [];
    const actorId =
      String(entity[this.actorField] || entity["created_by"] || entity["added_by"] || "");

    const record: AuditRecord = {
      entityName:    this.entityName,
      entityId:      String(entity.uuid || entity._id || ""),
      event,
      actorId:       actorId || undefined,
      whatWas,
      whatIs,
      changedFields,
      timestamp:     new Date(),
    };

    try {
      await this.auditModel.create(record);
    } catch (err) {
      // Audit log failures must never interrupt the main flow
      console.error(`[MetaManager] Audit log write failed for ${this.entityName}:`, err);
    }
  }

  /**
   * Query audit history for a specific entity document.
   */
  async getHistory(
    entityId: string,
    options?: { limit?: number; page?: number; event?: string }
  ): Promise<{ data: AuditRecord[]; total: number }> {
    if (!this.auditModel) return { data: [], total: 0 };

    const filter: Record<string, unknown> = { entityId };
    if (options?.event) filter.event = options.event;

    const limit = Math.min(options?.limit || 20, 200);
    const page  = Math.max(options?.page || 1, 1);
    const skip  = (page - 1) * limit;

    const [data, total] = await Promise.all([
      (this.auditModel.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).lean() as unknown) as Promise<AuditRecord[]>,
      this.auditModel.countDocuments(filter),
    ]);

    return { data: data as unknown as AuditRecord[], total };
  }
}
