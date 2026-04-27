import { MetaEntityOptions, ValidationResult } from "../types";
export declare class MetaValidator {
    private createSchema;
    private updateSchema;
    constructor(options: MetaEntityOptions);
    validate(data: unknown, mode: "create" | "update"): ValidationResult;
    hasSchema(): boolean;
}
//# sourceMappingURL=MetaValidator.d.ts.map