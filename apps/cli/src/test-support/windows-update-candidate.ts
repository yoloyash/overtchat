// Isolated release fixture for the native updater smoke; never published.
if (process.argv[2] !== "version") throw new Error("Expected startup version check");
console.log("99.0.0");
