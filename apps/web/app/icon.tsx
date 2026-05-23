import { ImageResponse } from "next/og";
import { loadFraunces } from "@/lib/icon-font";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default async function Icon() {
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
          fontSize: 400,
          lineHeight: 1,
          paddingBottom: 40,
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
