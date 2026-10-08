import { Pool } from "pg";
import "dotenv";

declare global {
    var pgPool: Pool | undefined;
}

if (!globalThis.pgPool) {
    globalThis.pgPool = new Pool({
        connectionString: process.env.DATABASE_URL
    });
}

export const pool = globalThis.pgPool;
