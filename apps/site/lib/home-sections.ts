export const HOME_SECTION_IDS = {
  intro: "intro",
  sharing: "sharing",
  voice: "voice",
  features: "features",
  architecture: "architecture",
  clients: "clients",
  quickStart: "quick-start",
  releases: "releases",
} as const;

export const HOME_SECTIONS = [
  { id: HOME_SECTION_IDS.intro, label: "Introduction" },
  { id: HOME_SECTION_IDS.sharing, label: "A front door" },
  { id: HOME_SECTION_IDS.voice, label: "Talk" },
  { id: HOME_SECTION_IDS.features, label: "Everyday chat" },
  { id: HOME_SECTION_IDS.architecture, label: "What yours means" },
  { id: HOME_SECTION_IDS.clients, label: "Anywhere" },
  { id: HOME_SECTION_IDS.quickStart, label: "Make it yours" },
  { id: HOME_SECTION_IDS.releases, label: "Releases" },
] as const;
