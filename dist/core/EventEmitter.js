"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetaEventEmitter = void 0;
const helpers_1 = require("../utils/helpers");
class MetaEventEmitter {
    constructor() {
        this.subscriptions = [];
    }
    on(types, callback) {
        this.subscriptions.push({ types, callback });
    }
    async emit(eventType, whatWas, whatIs, entity, diff) {
        for (const sub of this.subscriptions) {
            const matched = sub.types.some((pattern) => (0, helpers_1.eventMatches)(pattern, eventType, diff));
            if (matched) {
                try {
                    await Promise.resolve(sub.callback(whatWas, whatIs, entity));
                }
                catch (err) {
                    console.error(`[MetaManager] Event handler error for "${eventType}":`, err);
                }
            }
        }
    }
    removeAll() {
        this.subscriptions = [];
    }
}
exports.MetaEventEmitter = MetaEventEmitter;
//# sourceMappingURL=EventEmitter.js.map