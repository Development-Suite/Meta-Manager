export { MetaEntity } from "./core/MetaEntity";
export { MetaService } from "./core/MetaService";
export { MetaEventEmitter } from "./core/EventEmitter";
export { MetaValidator } from "./core/MetaValidator";
export { NestedOpsService } from "./core/NestedOpsService";
export { MetaAnalysisService } from "./core/MetaAnalysisService";
export { AuditLogService } from "./core/AuditLogService";
export { WebhookService } from "./core/WebhookService";
export { FieldPolicyService } from "./core/FieldPolicyService";
export { ScopedMetaService } from "./core/ScopedMetaService";
export { MigrationService } from "./core/MigrationService";
export { applyPopulationToOne, applyPopulationToMany, resolvePopulateDirectives } from "./core/PopulationMiddleware";
export { buildSchema } from "./core/SchemaBuilder";
export type { MetaEntityOptions, IMetaEntity, IMetaService, QueryOptions, PaginationOptions, PaginatedResult, CreateOptions, UpdateOptions, DeleteOptions, EventPath, EventType, EventCallback, EventSubscription, InterceptorAction, InterceptorCallback, InterceptorConfig, RelationConfig, RelationType, ChildEntityConfig, SchemaFields, FieldDefinition, JoiSchemaMap, ValidationResult, BaseEntityDocument, CustomRequest, CustomResponse, } from "./types";
export type { NestedOperation, NestedOpPayload, NestedOpResult } from "./types/nestedOps";
export type { AnalysisType, AnalysisOptions, AnalysisResult, AnalysisThreshold, TimeWindow, TimeUnit, CountResult, GrowthResult, SumResult, AverageResult, MinMaxResult, DistributionResult, TimeseriesResult, TopResult, RateResult, FieldChangeResult, FunnelResult, PercentileResult, } from "./types/analysis";
export { resolveIntendedFields } from "./types";
export type { PopulateConfig, FieldPolicyMap, FieldPolicy, FieldPolicyGuard, AuditLogOptions, AuditRecord, VirtualMap, VirtualDefinition, ScopedServiceOptions, MigrationDefinition, WebhookConfig, SerialiserOptions, SerialiserFn, } from "./types/features";
//# sourceMappingURL=index.d.ts.map