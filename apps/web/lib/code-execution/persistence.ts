"use client";

import type {
  CodeExecutionArtifact,
  CodeExecutionOutput,
} from "@overtchat/shared";
import { releasePythonOutput } from "./browser-python";

export async function persistPythonOutput(
  output: CodeExecutionOutput,
): Promise<CodeExecutionOutput> {
  if (output.outputs.length === 0) return output;

  try {
    const form = new FormData();
    for (const artifact of output.outputs) {
      const response = await fetch(artifact.url);
      if (!response.ok) throw new Error(`Could not read ${artifact.name}.`);
      const blob = await response.blob();
      form.append(
        "files",
        new File([blob], artifact.name, { type: artifact.mediaType }),
      );
    }

    const response = await fetch("/api/code-execution/artifacts", {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
    const body = (await response.json().catch(() => null)) as {
      artifacts?: CodeExecutionArtifact[];
      error?: string;
    } | null;
    if (!response.ok || !body?.artifacts) {
      throw new Error(body?.error || "Could not save generated files.");
    }
    return { ...output, outputs: body.artifacts };
  } finally {
    releasePythonOutput(output);
  }
}
