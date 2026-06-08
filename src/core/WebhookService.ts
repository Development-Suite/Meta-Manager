import { createHmac } from "crypto";
import { MetaEventEmitter } from "./EventEmitter";
import { WebhookConfig } from "../types/features";
import { eventMatches } from "../utils/helpers";

interface WebhookPayload {
  event:     string;
  entity:    string;
  timestamp: string;
  whatWas:   Record<string, unknown> | null;
  whatIs:    Record<string, unknown> | null;
  data:      Record<string, unknown>;
}

export class WebhookService {
  constructor(
    private readonly entityName: string,
    private readonly events:     MetaEventEmitter,
    private readonly configs:    WebhookConfig[]
  ) {
    this.registerSubscriptions();
  }

  private registerSubscriptions(): void {
    // Collect all unique event patterns across all webhook configs
    const allPatterns = [...new Set(this.configs.flatMap((c) => c.events))];

    this.events.on(allPatterns, async (whatWas, whatIs, entity) => {
      // Determine which event fired by checking the emitted type stored on entity
      // We re-check each config's patterns against this delivery
      const firedEvent = (entity as any).__lastEvent as string | undefined;
      if (!firedEvent) return;

      await Promise.allSettled(
        this.configs
          .filter((cfg) =>
            cfg.events.some((pattern) => eventMatches(pattern, firedEvent))
          )
          .map((cfg) =>
            this.deliver(cfg, firedEvent, whatWas, whatIs, entity as Record<string, unknown>)
          )
      );
    });
  }

  private async deliver(
    cfg:      WebhookConfig,
    event:    string,
    whatWas:  Record<string, unknown> | null,
    whatIs:   Record<string, unknown> | null,
    entity:   Record<string, unknown>
  ): Promise<void> {
    const payload: WebhookPayload = {
      event,
      entity:    this.entityName,
      timestamp: new Date().toISOString(),
      whatWas,
      whatIs,
      data:      entity,
    };

    const body    = JSON.stringify(payload);
    const timeout = cfg.timeout ?? 5000;
    const retries = cfg.retries ?? 2;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-MetaManager-Entity": this.entityName,
      "X-MetaManager-Event":  event,
      ...(cfg.headers || {}),
    };

    if (cfg.secret) {
      const sig = createHmac("sha256", cfg.secret).update(body).digest("hex");
      headers["X-MetaManager-Signature"] = `sha256=${sig}`;
    }

    let attempt = 0;
    while (attempt <= retries) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const res = await fetch(cfg.url, {
          method:  "POST",
          headers,
          body,
          signal:  controller.signal,
        });

        clearTimeout(timer);

        if (res.ok) return;

        // Non-2xx response — retry unless last attempt
        if (attempt === retries) {
          console.error(
            `[MetaManager] Webhook delivery failed (${res.status}) for ${this.entityName}.${event} -> ${cfg.url}`
          );
          return;
        }
      } catch (err: any) {
        if (attempt === retries) {
          console.error(
            `[MetaManager] Webhook delivery error for ${this.entityName}.${event} -> ${cfg.url}:`,
            err.message
          );
          return;
        }
      }

      attempt++;
      // Exponential backoff: 500ms, 1000ms
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

/**
 * Patch the EventEmitter to tag outgoing events with __lastEvent
 * so WebhookService can identify which pattern fired.
 */
export function patchEmitterForWebhooks(emitter: MetaEventEmitter): void {
  const originalEmit = emitter.emit.bind(emitter);
  (emitter as any).emit = async function(
    eventType: string,
    whatWas:   Record<string, unknown> | null,
    whatIs:    Record<string, unknown> | null,
    entity:    Record<string, unknown>,
    diff?:     any
  ) {
    // Tag entity with the current event type so webhook subscribers can read it
    const tagged = { ...entity, __lastEvent: eventType };
    return originalEmit(eventType, whatWas, whatIs, tagged, diff);
  };
}
