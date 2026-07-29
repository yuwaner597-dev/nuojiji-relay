import { createApp } from './src/app.js';
import { runProactiveTick } from './src/proactive/tick.js';

const app = createApp();

// 这是一个“自动翻译机器人”，把所有呼叫旧仓库(KV)的动作，变成呼叫新仓库(D1)
class D1KV {
    constructor(db) { this.db = db; }
    
    async get(key, options) {
        try {
            const type = (options && typeof options === 'object') ? options.type : options;
            const res = await this.db.prepare("SELECT value_data FROM outbox WHERE key_name = ?").bind(key).first("value_data");
            if (res === null || res === undefined) return null;
            if (type === 'json') {
                try { return JSON.parse(res); } catch(e) { return res; }
            }
            return res;
        } catch (e) { return null; }
    }
    
    // 🚨 核心修复：完美模拟原版 KV 的 getWithMetadata 技能
    async getWithMetadata(key, options) {
        try {
            const value = await this.get(key, options);
            return { value, metadata: {} };
        } catch (e) { return { value: null, metadata: {} }; }
    }
    
    async put(key, value, options) {
        try {
            let valStr;
            if (typeof value === 'string') {
                valStr = value;
            } else if (value instanceof ArrayBuffer) {
                valStr = String.fromCharCode.apply(null, new Uint8Array(value));
            } else {
                valStr = JSON.stringify(value);
            }
            await this.db.prepare("INSERT OR REPLACE INTO outbox (key_name, value_data) VALUES (?, ?)").bind(key, valStr).run();
        } catch (e) { console.error("KV put error:", e); }
    }
    
    async delete(key) {
        try {
            await this.db.prepare("DELETE FROM outbox WHERE key_name = ?").bind(key).run();
        } catch (e) { }
    }
    
    async list(options = {}) {
        try {
            let query = "SELECT key_name as name FROM outbox";
            let bind = [];
            if (options && options.prefix) {
                query += " WHERE key_name LIKE ?";
                bind.push(options.prefix + '%');
            }
            if (options && options.limit) {
                query += " LIMIT ?";
                bind.push(options.limit);
            }
            const stmt = this.db.prepare(query);
            const { results } = await (bind.length ? stmt.bind(...bind) : stmt).all();
            return { keys: results || [], list_complete: true };
        } catch (e) { return { keys: [], list_complete: true }; }
    }
}

export default {
    fetch: (req, env, ctx) => {
        // 无敌拦截：无论你在 toml 里起名叫 DB 还是 OUTBOX，只要它是 D1 数据库，统统强行套上翻译机器人！
        let rawDb = env.DB || env.OUTBOX;
        if (rawDb && typeof rawDb.prepare === 'function') {
            env.OUTBOX = new D1KV(rawDb);
        }
        return app.fetch(req, env, ctx);
    },
    async scheduled(_event, env, ctx) {
        let rawDb = env.DB || env.OUTBOX;
        if (rawDb && typeof rawDb.prepare === 'function') {
            env.OUTBOX = new D1KV(rawDb);
        }
        ctx.waitUntil(
            runProactiveTick(env).catch((e) => console.error('[scheduled] proactive tick failed:', e?.message))
        );
    },
};
