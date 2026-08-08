import packageMetadata from "../package.json" with { type: "json" };

export const CONNECTOR_VERSION = packageMetadata.version;
