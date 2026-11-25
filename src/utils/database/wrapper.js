import { MemoryStorage } from '../memoryStorage.js';
import { logger } from '../logger.js';
import { validateGuildConfigOrThrow } from '../schemas.js';

class DatabaseWrapper {
    constructor() {
        this.initialized = false;
        this.db = null;
        this.connectionType = 'none';
        this.degradedReason = null;
    }

    async initialize() {
        if (this.initialized) {
            return;
        }

        this.db = new MemoryStorage();
        this.connectionType = 'memory';
        this.degradedReason = null;
        logger.info('In-memory storage initialized; PostgreSQL is disabled and data resets on restart');
        this.initialized = true;
    }

    async set(key, value, ttl = null) {
        if (typeof key === 'string' && /^guild:[^:]+:config$/.test(key)) {
            const guildId = key.split(':')[1];
            validateGuildConfigOrThrow(value, {
                guildId,
                errorCode: 'VALIDATION_FAILED',
            });
        }

        return this.db.set(key, value, ttl);
    }

    async get(key, defaultValue = null) {
        return this.db.get(key, defaultValue);
    }

    async delete(key) {
        return this.db.delete(key);
    }

    async list(prefix) {
        return this.db.list(prefix);
    }

    async exists(key) {
        if (this.db.exists) {
            return this.db.exists(key);
        }
        const value = await this.db.get(key);
        return value !== null;
    }

    async increment(key, amount = 1) {
        if (this.db.increment) {
            return this.db.increment(key, amount);
        }
        const current = await this.db.get(key, 0);
        const newValue = current + amount;
        await this.db.set(key, newValue);
        return newValue;
    }

    async decrement(key, amount = 1) {
        if (this.db.decrement) {
            return this.db.decrement(key, amount);
        }
        const current = await this.db.get(key, 0);
        const newValue = current - amount;
        await this.db.set(key, newValue);
        return newValue;
    }

    isDegraded() {
        return false;
    }

    isAvailable() {
        return Boolean(this.db);
    }

    getStatus() {
        return {
            initialized: this.initialized,
            connectionType: this.connectionType,
            isDegraded: false,
            isAvailable: this.isAvailable(),
            isPersistent: this.connectionType === 'postgresql',
            degradedReason: this.degradedReason,
        };
    }

    getConnectionType() {
        return this.connectionType;
    }
}

export const db = new DatabaseWrapper();

export async function initializeDatabase() {
    try {
        logger.info('Initializing in-memory storage (PostgreSQL disabled)...');
        await db.initialize();
        logger.info('✅ Database initialized');
        return { db };
    } catch (error) {
        logger.error('❌ Database Initialization Error:', error);

        if (error.code === 'SCHEMA_VERSION_MISMATCH') {
            throw error;
        }

        return { db };
    }
}

export async function getFromDb(key, defaultValue = null) {
    try {
        const value = await db.get(key);
        return value === null ? defaultValue : value;
    } catch (error) {
        logger.error(`Error getting value for key ${key}:`, error);
        return defaultValue;
    }
}

export async function setInDb(key, value, ttl = null) {
    try {
        await db.set(key, value, ttl);
        return true;
    } catch (error) {
        logger.error(`Error setting value for key ${key}:`, error);
        return false;
    }
}

export async function deleteFromDb(key) {
    try {
        await db.delete(key);
        return true;
    } catch (error) {
        logger.error(`Error deleting key ${key}:`, error);
        return false;
    }
}
