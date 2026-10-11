import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "sqlite",
  casing: "snake_case",
  dbCredentials: {
    url: process.env.XIRYN_DATA_DIR
      ? `${process.env.XIRYN_DATA_DIR}/xiryn.db`
      : "./data/xiryn.db",
  },
})
