export const HOME_SECTION_IDS = {
  intro: "intro",
  howItWorks: "how-it-works",
  features: "features",
  architecture: "architecture",
  clients: "clients",
  quickStart: "quick-start",
  releases: "releases",
} as const;

export const HOME_SECTIONS = [
  { id: HOME_SECTION_IDS.intro, label: "Introduction" },
  { id: HOME_SECTION_IDS.howItWorks, label: "How it works" },
  { id: HOME_SECTION_IDS.features, label: "Features" },
  { id: HOME_SECTION_IDS.architecture, label: "Architecture" },
  { id: HOME_SECTION_IDS.clients, label: "Web + mobile" },
  { id: HOME_SECTION_IDS.quickStart, label: "Quick start" },
  { id: HOME_SECTION_IDS.releases, label: "Releases" },
] as const;
