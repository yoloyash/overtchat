"use client";

import type { UIMessage } from "ai";
import {
  MAX_CODE_EXECUTION_INPUT_BYTES,
  MAX_CODE_EXECUTION_INPUTS,
  MAX_CODE_EXECUTION_TOTAL_INPUT_BYTES,
  type CodeExecutionPart,
} from "@overtchat/shared";
import type { PythonInputFile } from "./browser-python";

type InputReference = { name: string; url: string };

export interface LoadedPythonInputs {
  files: PythonInputFile[];
  warnings: string[];
}

export async function loadPythonInputs(
  messages: readonly UIMessage[],
): Promise<LoadedPythonInputs> {
  const references = inputReferences(messages);
  const files: PythonInputFile[] = [];
  const warnings: string[] = [];
  let totalBytes = 0;

  for (const reference of references.slice(0, MAX_CODE_EXECUTION_INPUTS)) {
    try {
      if (!isAuthenticatedUploadUrl(reference.url)) continue;
      const response = await fetch(reference.url, { credentials: "same-origin" });
      if (!response.ok) {
        warnings.push(`Could not mount ${reference.name} (${response.status})`);
        continue;
      }
      const declaredSize = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredSize) &&
        declaredSize > MAX_CODE_EXECUTION_INPUT_BYTES
      ) {
        warnings.push(`Skipped ${reference.name}: input exceeds 20 MB`);
        continue;
      }
      const data = await response.arrayBuffer();
      if (data.byteLength > MAX_CODE_EXECUTION_INPUT_BYTES) {
        warnings.push(`Skipped ${reference.name}: input exceeds 20 MB`);
        continue;
      }
      if (totalBytes + data.byteLength > MAX_CODE_EXECUTION_TOTAL_INPUT_BYTES) {
        warnings.push(`Skipped ${reference.name}: inputs exceed 50 MB total`);
        continue;
      }
      files.push({ name: reference.name, data });
      totalBytes += data.byteLength;
    } catch {
      warnings.push(`Could not mount ${reference.name}`);
    }
  }

  if (references.length > MAX_CODE_EXECUTION_INPUTS) {
    warnings.push(
      `Only the first ${MAX_CODE_EXECUTION_INPUTS} chat files were mounted`,
    );
  }
  return { files, warnings };
}

export function inputReferences(
  messages: readonly UIMessage[],
): InputReference[] {
  const references: InputReference[] = [];
  const seenUrls = new Set<string>();
  const usedNames = new Set<string>();

  const add = (name: string | undefined, url: string | undefined) => {
    if (!url || seenUrls.has(url) || !isAuthenticatedUploadUrl(url)) return;
    seenUrls.add(url);
    references.push({
      name: uniqueFilename(name || "upload", usedNames),
      url,
    });
  };

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "file") {
        add(part.filename, part.url);
        continue;
      }
      if (part.type !== "tool-execute_code") continue;
      const codePart = part as CodeExecutionPart;
      for (const output of codePart.output?.outputs ?? []) {
        add(output.name, output.url);
      }
    }
  }
  return references;
}

function isAuthenticatedUploadUrl(value: string): boolean {
  return /^\/api\/uploads\/[^/?#]+$/u.test(value);
}

function uniqueFilename(value: string, used: Set<string>): string {
  const safe =
    value
      .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
      .trim()
      .slice(0, 180) || "upload";
  if (!used.has(safe)) {
    used.add(safe);
    return safe;
  }

  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const extension = dot > 0 ? safe.slice(dot) : "";
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem}-${suffix}${extension}`.slice(0, 180);
    if (used.has(candidate)) continue;
    used.add(candidate);
    return candidate;
  }
}
