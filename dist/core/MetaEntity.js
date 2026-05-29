"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetaEntity = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const MetaService_1 = require("./MetaService");
const MetaController_1 = require("./MetaController");
const EventEmitter_1 = require("./EventEmitter");
const NestedOpsService_1 = require("./NestedOpsService");
const MetaAnalysisService_1 = require("./MetaAnalysisService");
const SchemaBuilder_1 = require("./SchemaBuilder");
class MetaEntity {
    constructor(name, options = {}) {
        this.entityName = name;
        this.options = options;
        this.assertMongooseConnection();
        const schema = (0, SchemaBuilder_1.buildSchema)(options);
        const collectionName = options.collectionName || name.toLowerCase().replace(/\s+/g, "_");
        this.model =
            mongoose_1.default.models[name] ||
                mongoose_1.default.model(name, schema, collectionName);
        this.events = new EventEmitter_1.MetaEventEmitter();
        this.service = new MetaService_1.MetaService(this.model, options, this.events, name);
        this.nestedOps = new NestedOpsService_1.NestedOpsService(this.model, this.events);
        this.analysis = new MetaAnalysisService_1.MetaAnalysisService(this.model, name, this.events);
        this._controller = new MetaController_1.MetaController(this.service, this.nestedOps, this.analysis, name, options);
        this.controller = this._controller.router;
    }
    assertMongooseConnection() {
        const state = mongoose_1.default.connection.readyState;
        if (state === 0) {
            throw new Error(`[MetaManager] No active MongoDB connection detected when initializing entity "${this.entityName}". ` +
                `Call mongoose.connect() before creating MetaEntity instances.`);
        }
    }
    /**
     * Subscribe to entity lifecycle events with full TypeScript path inference.
     *
     * @example
     * booksEntity.trigger(["create"], (whatWas, whatIs, book) => { ... });
     * booksEntity.trigger(["update.title_name"], (whatWas, whatIs, book) => { ... });
     * booksEntity.trigger(["update.extra_data[*]"], (whatWas, whatIs, book) => { ... });
     * booksEntity.trigger(["update.extra_data[tokenName].Zugacoin"], (whatWas, whatIs, book) => { ... });
     */
    /**
     * Apply a single nested operation directly via the service layer (no HTTP).
     *
     * @example
     * await profileEntity.nested(id, {
     *   field: "services",
     *   operation: "patch_item",
     *   value: { _mmid: "abc123", "sub_services.0.basket_rate": 4000 }
     * });
     */
    /**
     * Run an analysis query directly via the service layer (no HTTP).
     * @example
     * await booksEntity.analyze({ type: "growth", window: { from: "2026-05-01", to: "2026-05-28" } })
     * await booksEntity.analyze({ type: "sum", field: "amount", window: { from, to } })
     */
    async analyze(options) {
        return this.analysis.run(options);
    }
    async nested(id, payload) {
        return this.nestedOps.apply(id, payload);
    }
    /**
     * Apply multiple nested operations in one call (batched into as few DB
     * round-trips as possible).
     */
    async nestedBatch(id, payloads) {
        return this.nestedOps.applyMany(id, payloads);
    }
    trigger(events, callback) {
        this.events.on(events, callback);
    }
    /**
     * Register middleware that runs before the specified controller action(s).
     *
     * @example
     * booksEntity.intercept("delete", (req, res, next) => {
     *   if (!req.user?.isAdmin) return res.status(403).json({ message: "Forbidden" });
     *   next();
     * });
     */
    intercept(action, callback) {
        this._controller.addInterceptor(action, callback);
    }
}
exports.MetaEntity = MetaEntity;
//# sourceMappingURL=MetaEntity.js.map