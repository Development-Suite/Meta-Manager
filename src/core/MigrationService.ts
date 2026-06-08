import { MigrationDefinition } from "../types/features";

export class MigrationService {
  private readonly sorted: MigrationDefinition[];
  private readonly latestVersion: number;

  constructor(migrations: MigrationDefinition[]) {
    this.sorted = [...migrations].sort((a, b) => a.version - b.version);
    this.latestVersion = this.sorted.length > 0
      ? this.sorted[this.sorted.length - 1].version
      : 0;
  }

  /**
   * Apply all pending migrations to a single document.
   * The document's __schemaVersion field tracks which migrations have already run.
   * Documents without __schemaVersion are treated as version 0.
   */
  async migrateOne(doc: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.sorted.length === 0) return doc;

    const currentVersion = typeof doc.__schemaVersion === "number"
      ? doc.__schemaVersion
      : 0;

    if (currentVersion >= this.latestVersion) return doc;

    let result = { ...doc };

    for (const migration of this.sorted) {
      if (migration.version <= currentVersion) continue;

      try {
        const migrated = await Promise.resolve(migration.up(result));
        result = { ...migrated, __schemaVersion: migration.version };
      } catch (err) {
        console.error(
          `[MetaManager] Migration v${migration.version} failed:`,
          err
        );
        // Do not abort — return the partially migrated doc
        break;
      }
    }

    return result;
  }

  /**
   * Apply migrations to a list of documents.
   */
  async migrateMany(docs: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    if (this.sorted.length === 0) return docs;
    return Promise.all(docs.map((d) => this.migrateOne(d)));
  }

  get latest(): number {
    return this.latestVersion;
  }

  hasMigrations(): boolean {
    return this.sorted.length > 0;
  }
}
