const { withGradleProperties } = require("expo/config-plugins");

// Expo's default 2 GB heap and 512 MB metaspace run out during a release build.
// The 1.23.0 build went silent for 102 minutes after its Gradle daemon logged an
// OutOfMemoryError, instead of failing.
const JVM_ARGS = "-Xmx4096m -XX:MaxMetaspaceSize=1024m";

module.exports = function withAndroidGradleHeap(config) {
  return withGradleProperties(config, (nextConfig) => {
    nextConfig.modResults = nextConfig.modResults.filter(
      (item) =>
        !(item.type === "property" && item.key === "org.gradle.jvmargs"),
    );
    nextConfig.modResults.push({
      type: "property",
      key: "org.gradle.jvmargs",
      value: JVM_ARGS,
    });
    return nextConfig;
  });
};
