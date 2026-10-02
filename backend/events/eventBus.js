import { EventEmitter } from "events";

class DomainEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }

  emit(eventName, payload = {}) {
    const eventPayload =
      payload && typeof payload === "object"
        ? { occurredAt: new Date(), ...payload }
        : { occurredAt: new Date(), value: payload };

    return super.emit(eventName, eventPayload);
  }
}

const eventBus = new DomainEventBus();

export default eventBus;
