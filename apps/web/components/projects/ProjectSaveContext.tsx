"use client";

import { createContext, useContext } from "react";

/** The project a chat belongs to, for saving its files into the project. */
export interface ProjectSaveTarget {
  chatId: string;
  project: { id: string; name: string };
}

const ProjectSaveContext = createContext<ProjectSaveTarget | null>(null);

export const ProjectSaveProvider = ProjectSaveContext.Provider;

/** Null outside a project chat; panels then offer no "Save to project". */
export function useProjectSaveTarget(): ProjectSaveTarget | null {
  return useContext(ProjectSaveContext);
}
