import { pool } from "../config/db.js";
import { databaseSchema } from "../sql/dbObject.js";


(async (): Promise<void> => {
    for (const { name, sql } of databaseSchema) {
        try {

            await pool.query(sql);
            console.log(`Table ${name} created successfully`);
        } catch (error) {
            console.error(`Error creating table ${name}:`, error);
        }
    }

    pool.end();
}
)();

