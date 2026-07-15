import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/adapters/schema.ts',
  out: './src/adapters/drizzle',
})
