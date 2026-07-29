import { createApp } from './src/app.js';
import { runProactiveTick } from './src/proactive/tick.js';

const app = createApp();

class D1KV {
    constructor(db) { this.db = db; }
    
    async get(key, options) {
        try {
            const type = (options && typeof options === 'object') ? options.type : options;
            const res = await this.db.prepare("SELECT value_data FROM outbox WHERE key_name = ?").bind(key).first("value_data");
            
            if (res === null || res === undefined) return null;
            if (type === 'json') return JSON.parse(res);
            return res;
        } catch (e) { 
            console.error(`[D1KV GET 错误] 键名: ${key}, 原因:`, e.message); 
            return null; 
        }
    }
    
    async put(key, value, options) {
        try {
            const valStr = typeof value === 'string' ? value : JSON.stringify(value);
            await this.db.prepare("INSERT OR REPLACE INTO outbox (key_name, value_data) VALUES (?, ?)").bind(key, valStr).run();
        } catch (e) { 
            console.error(`[D1KV PUT 错误] 键名: ${key}, 原因:`, e.message); 
        }
    }
    
    async delete(key) {
        try {
            await this.db.prepare("DELETE FROM outbox WHERE key_name = ?").bind(key).run();
        } catch (e) { 
            console.error(`[D1KV DELETE 错误] 键名: ${key}, 原因:`, e.message); 
        }
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
        } catch (e) { 
            console.error(`[D1KV LIST 错误] 原因:`, e.message); 
            return { keys: [], list_complete: true }; 
        }
    }
}

export default {
    fetch: (req, env, ctx) => {
        // 克隆环境变量，防止 Cloudflare 报错
        const customEnv = { ...env };
        if (customEnv.DB && !customEnv.OUTBOX) customEnv.OUTBOX = new D1KV(customEnv.DB);
        return app.fetch(req, customEnv, ctx);
    },
    
    async scheduled(_event, env, ctx) {
        const customEnv = { ...env };
        if (customEnv.DB && !customEnv.OUTBOX) customEnv.OUTBOX = new D1KV(customEnv.DB);
        ctx.waitUntil(
            runProactiveTick(customEnv).catch((e) => console.error('[定时任务失败]:', e?.message))
        );
    },
};
