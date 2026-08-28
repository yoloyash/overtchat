import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const webRoot = path.resolve(import.meta.dirname, "..");
const dataRoot = path.join(webRoot, "data");
const nextRoot = path.join(webRoot, ".next");
const instrumentationTrace = path.join(
  nextRoot,
  "server",
  "instrumentation.js.nft.json",
);
const standaloneData = path.join(
  nextRoot,
  "standalone",
  "apps",
  "web",
  "data",
);

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function removeDataFromInstrumentationTrace() {
  let trace;
  try {
    trace = JSON.parse(await readFile(instrumentationTrace, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }

  const traceDir = path.dirname(instrumentationTrace);
  const files = Array.isArray(trace.files) ? trace.files : [];
  const filtered = files.filter(
    (file) => !isWithin(dataRoot, path.resolve(traceDir, file)),
  );
  const removed = files.length - filtered.length;

  if (removed > 0) {
    await writeFile(
      instrumentationTrace,
      JSON.stringify({ ...trace, files: filtered }),
    );
  }
  return removed;
}

const removedTraceEntries = await removeDataFromInstrumentationTrace();
await rm(standaloneData, { recursive: true, force: true });

if (removedTraceEntries > 0) {
  console.log(
    `Removed ${removedTraceEntries} runtime-data entries from the standalone build trace.`,
  );
}
