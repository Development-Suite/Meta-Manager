import { EventCallback } from "../types";
export declare class MetaEventEmitter {
    private subscriptions;
    on(types: string[], callback: EventCallback<any>): void;
    emit(eventType: string, whatWas: Record<string, unknown> | null, whatIs: Record<string, unknown> | null, entity: Record<string, unknown>, diff?: {
        whatWas: Record<string, unknown>;
        whatIs: Record<string, unknown>;
    }): Promise<void>;
    removeAll(): void;
}
//# sourceMappingURL=EventEmitter.d.ts.map