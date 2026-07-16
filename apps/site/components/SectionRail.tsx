"use client";

import { useEffect, useState } from "react";

const sections = [
  { id: "intro", label: "Introduction" },
  { id: "how-it-works", label: "How it works" },
  { id: "features", label: "Features" },
  { id: "architecture", label: "Architecture" },
  { id: "clients", label: "Web + mobile" },
  { id: "quick-start", label: "Quick start" },
  { id: "releases", label: "Releases" },
];

export function SectionRail() {
  const [activeSection, setActiveSection] = useState(sections[0].id);

  useEffect(() => {
    let frame = 0;

    const updateActiveSection = () => {
      const threshold = window.innerHeight * 0.34;
      let current = sections[0].id;

      for (const section of sections) {
        const element = document.getElementById(section.id);
        if (element && element.getBoundingClientRect().top <= threshold) {
          current = section.id;
        }
      }

      setActiveSection(current);
      frame = 0;
    };

    const handleScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(updateActiveSection);
    };

    updateActiveSection();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, []);

  return (
    <nav className="section-rail" aria-label="Home page sections">
      {sections.map((section) => {
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
