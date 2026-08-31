export function projectSystemPrompt(project: {
  name: string;
  instructions: string | null;
} | null): string | null {
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
  return parts.join("\n");
}
