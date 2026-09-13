import os from "node:os";

export function primaryLanAddress(): string | null {
  const candidates = Object.entries(os.networkInterfaces())
    .filter(([name]) => !/^(?:lo$|docker|br-|veth|tailscale|tun\d|tap\d|virbr)/u.test(name))
    .flatMap(([, addresses]) => addresses ?? [])
    .filter(
      (address) =>
        address.family === "IPv4" &&
        !address.internal &&
        address.address !== "0.0.0.0",
    );
  const privateAddress = candidates.find((address) => {
    const value = address.address;
    return (
      value.startsWith("10.") ||
      value.startsWith("192.168.") ||
      /^172\.(?:1[6-9]|2\d|3[01])\./u.test(value)
    );
  });
  return privateAddress?.address ?? null;
}
