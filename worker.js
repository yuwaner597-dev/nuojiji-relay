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
            if (type === 'json') return JSON.parse(res);
            return res;
        } catch (e) { return null; }
    }
    
    async put(key, value, options) {
        try {
            const valStr = typeof value === 'string' ? value : JSON.stringify(value);
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
            if (options.prefix) {
                query += " WHERE key_name LIKE ?";
                bind.push(options.prefix + '%');
            }
            if (options.limit) {
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
        // 在门口拦截：如果发现有新仓库DB，就立刻造一个叫 OUTBOX 的假仓库（其实就是上面的翻译机器人）
        if (env.DB && !env.OUTBOX) env.OUTBOX = new D1KV(env.DB);
        return app.fetch(req, env, ctx);
    },
    async scheduled(_event, env, ctx) {
        // 定时任务也一样在门口拦截
        if (env.DB && !env.OUTBOX) env.OUTBOX = new D1KV(env.DB);
        ctx.waitUntil(
            runProactiveTick(env).catch((e) => console.error('[scheduled] proactive tick failed:', e?.message))
        );
    },
};
