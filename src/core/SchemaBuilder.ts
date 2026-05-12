import { Schema } from "mongoose";
import { SchemaFields, MetaEntityOptions } from "../types";

const BASE_FIELDS: SchemaFields = {
  uuid: {
    type: String,
    default: undefined,
    unique: true,
    index: true,
  },
  request_id: { type: String, default: null },
  meta_key: { type: String, default: null, index: true },
  meta_value: { type: String, default: null },
  data_type: { type: String, default: null },
  title_name: { type: String, default: null },
  description: { type: String, default: null },
  entity_featured_url: { type: String, default: null },
  extra_data: { type: Schema.Types.Mixed, default: [] },
  meta_data: { type: Schema.Types.Mixed, default: [] },
  status: {
    type: String,
    enum: ["active", "inactive", "archived"],
    default: "active",
    index: true,
  },
  parent_entity_type: { type: String, default: null },
  parent_entity: { type: String, default: null },
  owned_by: { type: String, default: null, index: true },
  added_by: { type: String, default: null },
  created_by: { type: String, default: null },
  updated_by: { type: String, default: null },
  slug: { type: String, default: null, index: true },
  deleted_at: { type: Date, default: null },
};

import { v4 as uuidv4 } from "uuid";

function injectMmids(doc: any): void {
  if (!doc || typeof doc !== "object") return;
  const obj = doc.toObject ? doc.toObject({ virtuals: false }) : doc;
  for (const key of Object.keys(obj)) {
    const val = (doc as any)[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === "object" && !Array.isArray(item) && !item._mmid) {
          item._mmid = uuidv4();
        }
      }
    }
  }
}

export function buildSchema(options: MetaEntityOptions): Schema {
  const fields: SchemaFields = {
    ...BASE_FIELDS,
    ...(options.additionalFields || {}),
  };

  if (options.parents) {
    for (const parent of options.parents) {
      if (!fields[parent.foreignKey]) {
        fields[parent.foreignKey] = {
          type: String,
          required: true,
          index: true,
        };
      }
    }
  }

  if (options.sisters) {
    for (const sister of options.sisters) {
      if (!fields[sister.foreignKey]) {
        fields[sister.foreignKey] = {
          type: String,
          required: true,
          index: true,
        };
      }
    }
  }

  const schema = new Schema(fields as any, {
    timestamps: options.timestamps !== false
      ? { createdAt: "created_at", updatedAt: "updated_at" }
      : false,
    collection: options.collectionName,
    strict: false,
  });

  schema.pre("save", function (next) {
    if (!this.uuid) {
      const { v4: uuidv4 } = require("uuid");
      this.uuid = uuidv4();
    }
    next();
  });

  // Inject _mmid into every element of every array field that holds objects,
  // so nested items have a stable identity without requiring a sub-schema.
  schema.post("init", function (doc: any) {
    injectMmids(doc);
  });

  schema.pre("save", function (next) {
    injectMmids(this as any);
    next();
  });

  if (options.searchableFields && options.searchableFields.length > 0) {
    const textIndex: Record<string, "text"> = {};
    for (const f of options.searchableFields) {
      textIndex[f] = "text";
    }
    schema.index(textIndex);
  }

  return schema;
}
