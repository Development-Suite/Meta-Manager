import { EventCallback, EventSubscription } from "../types";
import { eventMatches } from "../utils/helpers";

export class MetaEventEmitter {
  private subscriptions: EventSubscription[] = [];

  on(types: string[], callback: EventCallback<any>): void {
    this.subscriptions.push({ types, callback });
  }

  async emit(
    eventType: string,
    whatWas: Record<string, unknown> | null,
    whatIs: Record<string, unknown> | null,
    entity: Record<string, unknown>,
    diff?: { whatWas: Record<string, unknown>; whatIs: Record<string, unknown> }
  ): Promise<void> {
    for (const sub of this.subscriptions) {
      const matched = sub.types.some((pattern) =>
        eventMatches(pattern, eventType, diff)
      );
      if (matched) {
        try {
          await Promise.resolve(sub.callback(whatWas, whatIs, entity));
        } catch (err) {
          console.error(`[MetaManager] Event handler error for "${eventType}":`, err);
        }
      }
    }
  }

  removeAll(): void {
    this.subscriptions = [];
  }
}
