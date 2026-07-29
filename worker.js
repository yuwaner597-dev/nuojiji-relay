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
    
    // 🚨 核心修复：补上原版 KV 自带的 getWithMetadata 技能！
    async getWithMetadata(key, options) {
        try {
            const value = await this.get(key, options);
            // 我们的表没有专门存 metadata 的列，所以直接返回空 metadata 骗过系统即可
            return { value, metadata: null };
        } catch (e) { return { value: null, metadata: null }; }
    }
    
    async put(key, value, options) {
        try {
            let valStr;
            // 增强防弹衣：防止奇奇怪怪的二进制流或者超大对象让机器人崩溃
            if (typeof value === 'string') {
                valStr = value;
            } else if (value instanceof ArrayBuffer) {
                // 如果是特殊的流文件（比如头像流），强转为字符串
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
