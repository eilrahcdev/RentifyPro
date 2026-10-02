import "dotenv/config";
import { getProductionConfigurationErrors } from "../utils/productionConfig.js";

const errors = getProductionConfigurationErrors();
if (errors.length) {
  for (const error of errors) console.error(`FAIL: ${error}`);
  process.exitCode = 1;
} else {
  console.log("PASS: Production configuration checks. Verify provider delivery, mounted-volume persistence, database indexes, and backup restore separately.");
}
