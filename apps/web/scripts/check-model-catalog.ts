import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateModelCatalogArtifacts } from "./model-catalog-artifacts";

const catalogPath = resolve(
  process.cwd(),
  "lib/providers/server/model-catalog.json",
);
const manifestPath = resolve(
  process.cwd(),
  "lib/providers/server/model-catalog.manifest.json",
);

try {
  const manifest = validateModelCatalogArtifacts(
    readFileSync(catalogPath, "utf8"),
    readFileSync(manifestPath, "utf8"),
  );
  console.log(
    `validated ${manifest.modelCount} models generated at ${manifest.generatedAt}`,
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
