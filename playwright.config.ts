import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/http",
  fullyParallel: true,
  use: { baseURL: process.env.CITYPROOF_TEST_URL || "http://127.0.0.1:3000" },
  reporter: "list",
});
