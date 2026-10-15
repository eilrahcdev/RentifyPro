import mongoose from "mongoose";

export class MemoryChatbotLimitStore {
  constructor({ maxEntries = 10000, sweepIntervalMs = 1000 } = {}) {
    this.records = new Map(); this.maxEntries = maxEntries;
    this.sweepIntervalMs = sweepIntervalMs; this.nextSweepAt = 0;
  }

  sweep(now) {
    for (const [key, row] of this.records) if (new Date(row.expiresAt).getTime() <= now) this.records.delete(key);
    this.nextSweepAt = now + this.sweepIntervalMs;
  }

  async transact(keys, now, transform) {
    if (now >= this.nextSweepAt) this.sweep(now);
    for (const key of keys) if (new Date(this.records.get(key)?.expiresAt || 0).getTime() <= now) this.records.delete(key);
    const { result, writes = [] } = transform(new Map(keys.map(key => [key, this.records.get(key)])));
    if (this.records.size + writes.filter(row => !this.records.has(row._id)).length > this.maxEntries) this.sweep(now);
    const additions = writes.filter(row => !this.records.has(row._id)).length;
    if (this.records.size + additions > this.maxEntries) throw new Error("Chatbot counter capacity reached");
    for (const row of writes) this.records.set(row._id, row);
    return result;
  }
}

// Only temporary pseudonymous counters/leases live here, never business records.
export class MongoChatbotLimitStore {
  constructor(connection = mongoose.connection) { this.connection = connection; this.indexReady = null; }

  async transact(keys, now, transform) {
    if (this.connection.readyState !== 1) throw new Error("Chatbot shared store unavailable");
    const collection = this.connection.db.collection("chatbot_limits");
    this.indexReady ||= collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.indexReady.catch(error => { this.indexReady = null; throw error; });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const session = await this.connection.startSession();
      try {
        return await session.withTransaction(async () => {
          const rows = await collection.find({ _id: { $in: keys } }, { session }).toArray();
          const { result, writes = [] } = transform(new Map(rows.map(row => [row._id, row])), now);
          for (const { _id, ...row } of writes) await collection.updateOne({ _id }, { $set: row }, { upsert: true, session });
          return result;
        }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
      } catch (error) {
        // Two first requests can race to create a unique counter. Re-read it in
        // a new transaction; never retry classification or allow on store error.
        if (error.code !== 11000 || attempt === 2) throw error;
      } finally { await session.endSession(); }
    }
  }
}
