import { describe, expect, it } from "vitest";
import { parseNvidiaSmi } from "./docker.js";

describe("NVIDIA GPU discovery", () => {
  it("keeps stable UUIDs alongside the friendly index and memory", () => {
    expect(
      parseNvidiaSmi(
        "0, GPU-4090, NVIDIA GeForce RTX 4090, 24564\n1, GPU-A4000, NVIDIA RTX A4000, 16376\n",
      ),
    ).toEqual([
      {
        index: 0,
        uuid: "GPU-4090",
        name: "NVIDIA GeForce RTX 4090",
        memoryMiB: 24_564,
      },
      {
        index: 1,
        uuid: "GPU-A4000",
        name: "NVIDIA RTX A4000",
        memoryMiB: 16_376,
      },
    ]);
  });

  it("ignores malformed rows rather than offering broken devices", () => {
    expect(parseNvidiaSmi("not,a,gpu,row\n2, GPU-ok, RTX 6000, 49140"))
      .toEqual([
        {
          index: 2,
          uuid: "GPU-ok",
          name: "RTX 6000",
          memoryMiB: 49_140,
        },
      ]);
  });
});
