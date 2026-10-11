import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "sqlite",
  casing: "snake_case",
  dbCredentials: {
    url: process.env.ORYN_DATA_DIR
      ? `${process.env.ORYN_DATA_DIR}/oryn.db`
      : "./data/oryn.db",
  },
})
