import { notFound } from "next/navigation";
import { ClientOnly } from "./client";

export function generateStaticParams() {
  return [{ slug: [""] }];
}

/** Serves the client-side UI for every path that is not an API route or asset. */
export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  // Unknown API paths stay 404s instead of returning the UI.
  if (slug?.[0] === "api") notFound();
  return <ClientOnly />;
}
