"use client";

import { Download, FileText } from "lucide-react";
import type { CodeExecutionArtifact } from "@overtchat/shared";

export function CodeExecutionArtifacts({
  artifacts,
}: {
  artifacts: readonly CodeExecutionArtifact[];
}) {
  if (artifacts.length === 0) return null;
  return (
    <div className="space-y-2 font-sans">
      {artifacts.map((artifact) =>
        artifact.kind === "image" ? (
          <div
            key={`${artifact.url}:${artifact.name}`}
            className="overflow-hidden rounded-lg border bg-background"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={artifact.url}
              alt={artifact.name}
              className="max-h-96 w-full object-contain"
            />
            <ArtifactFooter artifact={artifact} />
          </div>
        ) : (
          <a
            key={`${artifact.url}:${artifact.name}`}
            href={artifact.url}
            download={artifact.name}
            className="flex items-center gap-2.5 rounded-lg border bg-background px-3 py-2 text-foreground transition-colors hover:bg-accent"
          >
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-medium">
              {artifact.name}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatBytes(artifact.byteLength)}
            </span>
            <Download className="size-4 shrink-0 text-muted-foreground" />
          </a>
        ),
      )}
    </div>
  );
}

function ArtifactFooter({ artifact }: { artifact: CodeExecutionArtifact }) {
  return (
    <div className="flex items-center gap-2 border-t px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-xs font-medium">
        {artifact.name}
      </span>
      <span className="text-xs text-muted-foreground">
        {formatBytes(artifact.byteLength)}
      </span>
      <a
        href={artifact.url}
        download={artifact.name}
        aria-label={`Download ${artifact.name}`}
        title={`Download ${artifact.name}`}
        className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Download className="size-4" />
      </a>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
