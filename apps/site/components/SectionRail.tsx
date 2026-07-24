"use client";

import { useEffect, useState } from "react";
import { HOME_SECTIONS } from "@/lib/home-sections";

const OBSERVER_ROOT_MARGIN = "-84px 0px -55% 0px";
type HomeSectionId = (typeof HOME_SECTIONS)[number]["id"];

export function SectionRail() {
  const [activeSection, setActiveSection] = useState<HomeSectionId>(HOME_SECTIONS[0].id);

  useEffect(() => {
    const visibleSections = new Set<HomeSectionId>();
    const sectionIds = new Set(HOME_SECTIONS.map((section) => section.id));
    const elements = HOME_SECTIONS.flatMap((section) => {
      const element = document.getElementById(section.id);
      return element ? [element] : [];
    });

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleSections.add(entry.target.id as HomeSectionId);
          } else {
            visibleSections.delete(entry.target.id as HomeSectionId);
          }
        }

        let nextSection: HomeSectionId | null = null;
        for (const section of HOME_SECTIONS) {
          if (visibleSections.has(section.id)) nextSection = section.id;
        }

        if (nextSection) setActiveSection(nextSection);
      },
      {
        rootMargin: OBSERVER_ROOT_MARGIN,
        threshold: 0,
      },
    );

    const syncSectionFromHash = () => {
      const sectionId = window.location.hash.slice(1) as HomeSectionId;

      if (sectionIds.has(sectionId)) {
        setActiveSection(sectionId);
      }
    };

    elements.forEach((element) => observer.observe(element));
    syncSectionFromHash();
    window.addEventListener("hashchange", syncSectionFromHash);

    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", syncSectionFromHash);
    };
  }, []);

  return (
    <nav className="section-rail" aria-label="Home page sections">
      {HOME_SECTIONS.map((section) => {
        const active = activeSection === section.id;

        return (
          <a
            key={section.id}
            href={`#${section.id}`}
            aria-label={section.label}
            aria-current={active ? "location" : undefined}
          >
            <span className="section-rail-label">{section.label}</span>
            <span className="section-rail-dot" aria-hidden="true" />
          </a>
        );
      })}
    </nav>
  );
}
