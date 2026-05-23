import { ImageResponse } from "next/og";
import { loadFraunces } from "@/lib/icon-font";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  const fraunces = await loadFraunces();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#23261f",
          color: "#f5f5f0",
          fontFamily: "Fraunces",
          fontSize: 140,
          lineHeight: 1,
          paddingBottom: 14,
        }}
      >
        o
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Fraunces", data: fraunces, style: "normal", weight: 500 }],
    },
  );
}
