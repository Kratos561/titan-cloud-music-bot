const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
require("dotenv").config();

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Falta DATABASE_URL para ejecutar migraciones.");
  }

  const sql = fs.readFileSync(path.join(__dirname, "..", "database", "schema.sql"), "utf8");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes("sslmode=require")
      ? undefined
      : { rejectUnauthorized: false },
  });

  try {
    await pool.query(sql);
    console.log("Migraciones aplicadas correctamente.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
