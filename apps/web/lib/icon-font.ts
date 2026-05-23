let cached: ArrayBuffer | null = null;

export async function loadFraunces(): Promise<ArrayBuffer> {
  if (cached) return cached;

  const cssRes = await fetch(
    "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500&text=o",
    { headers: { "User-Agent": "Mozilla/5.0" } },
  );
  const css = await cssRes.text();
  const match = css.match(/src: url\((https:\/\/[^)]+)\) format/);
  if (!match) throw new Error("failed to parse Fraunces font URL");

  const fontRes = await fetch(match[1]);
  cached = await fontRes.arrayBuffer();
  return cached;
}
