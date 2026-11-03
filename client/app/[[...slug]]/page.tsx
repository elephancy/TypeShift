import App from "../../src/App";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isSupportedAppPath } from "../../src/lib/app-routes";
import { searchMetadata } from "../../src/lib/search-metadata";

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  return searchMetadata((await params).slug ?? []);
}

export default async function TypeShiftPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  if (!isSupportedAppPath((await params).slug ?? [])) notFound();
  return <App />;
}
