import "dotenv/config";
import { defineConfig } from "prisma/config";

const dbUrl = process.env["DATABASE_URL"] || "";

// Guard to prevent accidental overwrites/pushes to the wrong database
if (
  dbUrl &&
  (dbUrl.includes("ep-muddy-wildflower-ac17lfjr") ||
    dbUrl.includes("ep-gentle-shape-acftnaqg") ||
    dbUrl.includes("kermingo"))
) {
  console.error(
    "ERROR: DATABASE_URL points to Kermingo. Execution blocked to prevent overwriting the kermingo database."
  );
  process.exit(1);
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: dbUrl,
  },
});
