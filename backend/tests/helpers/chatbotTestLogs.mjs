import { registerHooks } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const auditLoggerUrl = new URL("../../middleware/auditLogger.middleware.js", import.meta.url).href;
const testLogDirectory = mkdtempSync(path.join(tmpdir(), "rentifypro-chatbot-test-logs-"));
const declaration = 'const LOG_DIR = path.join(__dirname, "..", "logs");';

// Preserve logger behavior while keeping HTTP test output out of the working tree.
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== auditLoggerUrl) return loaded;
    const source = String(loaded.source);
    if (!source.includes(declaration)) throw new Error("Chatbot test log redirection must match the audit logger");
    return { ...loaded, source: source.replace(declaration, `const LOG_DIR = ${JSON.stringify(testLogDirectory)};`) };
  },
});
