import { describe, expect, it } from "vitest";
import { projectSystemPrompt } from "./project-prompt";

describe("projectSystemPrompt", () => {
  it("is empty outside a project", () => {
    expect(projectSystemPrompt(null)).toBeNull();
    expect(projectSystemPrompt(null, [{ uploadId: "u", name: "spec.pdf", mediaType: "application/pdf" }])).toBeNull();
  });

  it("names the project and its instructions", () => {
    expect(projectSystemPrompt({ name: "Launch", instructions: " Be brief. " })).toBe(
      'Project context:\nYou are working in a project named "Launch".\n\nUser-provided project instructions:\n Be brief. ',
    );
    expect(projectSystemPrompt({ name: "Launch", instructions: "  " })).not.toContain("instructions");
    expect(projectSystemPrompt({ name: "Launch", instructions: null })).not.toContain("Project files");
  });

  it("lists project files by their tool names and points at the file tools", () => {
    const prompt = projectSystemPrompt({ name: "Launch", instructions: null }, [
      { uploadId: "a", name: "spec.pdf", mediaType: "application/pdf" },
      { uploadId: "b", name: "spec (2).pdf", mediaType: "application/pdf" },
    ]);
    expect(prompt).toContain("Project files (reference material shared by every chat in this project, not included in the conversation):\n- spec.pdf\n- spec (2).pdf\n");
    expect(prompt).toContain("search_files");
    expect(prompt).toContain("read_file");
  });
});
