import type { ChatFile } from "@/lib/chat/chat-files";

export function projectSystemPrompt(
  project: {
    name: string;
    instructions: string | null;
  } | null,
  files: readonly ChatFile[] = [],
): string | null {
  if (!project) return null;

  const parts = [
    "Project context:",
    `You are working in a project named ${JSON.stringify(project.name)}.`,
  ];
  if (project.instructions?.trim()) {
    parts.push(
      "",
      "User-provided project instructions:",
      project.instructions,
    );
  }
  if (files.length > 0) {
    parts.push(
      "",
      "Project files (reference material shared by every chat in this project, not included in the conversation):",
      ...files.map((file) => `- ${file.name}`),
      "When a question may draw on them, find passages with search_files or read them with read_file before answering, and say which file you used.",
    );
  }
  return parts.join("\n");
}
