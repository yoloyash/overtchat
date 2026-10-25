import { openuiChatLibrary } from "@openuidev/react-ui/genui-lib";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const file = path.resolve("lib/openui/chat-library-spec.json");
const spec = JSON.stringify(openuiChatLibrary.toSpec(), null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (
    JSON.stringify(JSON.parse(readFileSync(file, "utf8"))) !==
    JSON.stringify(openuiChatLibrary.toSpec())
  ) {
    throw new Error(
      "OpenUI spec is stale. Run npm run openui:generate -w apps/web.",
    );
  }
} else {
  writeFileSync(file, spec);
}
