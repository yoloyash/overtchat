"use client";

import {
  Boxes,
  Brain,
  Folder,
  KeyRound,
  Lock,
  MessageSquareText,
  Server,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useInView, usePrefersReducedMotion } from "@/lib/use-motion";

const PEOPLE = [
  {
    id: "you",
    initial: "Y",
    name: "You",
    role: "Admin",
    space: "Your private space",
    chats: ["Model benchmarks", "Backup checklist"],
    project: "Home lab",
    memory: "Prefers short answers",
  },
  {
    id: "maya",
    initial: "M",
    name: "Maya",
    role: "Private history",
    space: "Maya’s private space",
    chats: ["Weeknight meals", "Homework helper"],
    project: "Household",
    memory: "Cooks vegetarian",
  },
  {
    id: "sam",
    initial: "S",
    name: "Sam",
    role: "Private history",
    space: "Sam’s private space",
    chats: ["Trip to Lisbon", "Guitar practice"],
    project: "Travel",
    memory: "Learning Portuguese",
  },
] as const;

const ROTATE_MS = 3600;

/** One model server, one OvertChat, and a separate private space per account. */
export function AccessDemo() {
  const reducedMotion = usePrefersReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>(0.5);
  const [selected, setSelected] = useState(1);
  const [touched, setTouched] = useState(false);
  const person = PEOPLE[selected];

  useEffect(() => {
    if (touched || reducedMotion || !inView) return;
    const timer = window.setTimeout(
      () => setSelected((selected + 1) % PEOPLE.length),
      ROTATE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [touched, reducedMotion, inView, selected]);

  function choose(index: number) {
    setTouched(true);
    setSelected(index);
  }

  return (
    <div
      className="access-card"
      ref={ref}
      role="group"
      aria-label="A private model server connected through OvertChat to separate user accounts"
      data-reveal=""
    >
      <div className="access-node">
        <span className="access-node-icon"><Server aria-hidden="true" /></span>
        <div>
          <strong>Your model server</strong>
          <small>One private endpoint</small>
        </div>
      </div>
      <span className="access-link" aria-hidden="true"><i /></span>
      <div className="access-node access-node-primary">
        <span className="access-node-icon"><Boxes aria-hidden="true" /></span>
        <div>
          <strong>OvertChat</strong>
          <small>Accounts, chat, voice, files</small>
        </div>
      </div>
      <span className="access-link" aria-hidden="true"><i /></span>
      <div className="access-people">
        {PEOPLE.map((entry, index) => (
          <button
            type="button"
            className="access-person"
            key={entry.id}
            aria-pressed={index === selected}
            onClick={() => choose(index)}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") choose(index);
            }}
          >
            <span>{entry.initial}</span>
            <div>
              <strong>{entry.name}</strong>
              <small>{entry.role}</small>
            </div>
          </button>
        ))}
      </div>
      <div className="access-space" aria-live={touched ? "polite" : "off"}>
        <p>
          <Lock aria-hidden="true" />
          {person.space}
        </p>
        <ul key={person.id}>
          {person.chats.map((chat) => (
            <li key={chat}>
              <MessageSquareText aria-hidden="true" />
              {chat}
            </li>
          ))}
          <li>
            <Folder aria-hidden="true" />
            {person.project}
          </li>
          <li>
            <Brain aria-hidden="true" />
            {person.memory}
          </li>
        </ul>
      </div>
      <div className="access-safety">
        <span><KeyRound aria-hidden="true" /> Admin-created accounts</span>
        <span><ShieldCheck aria-hidden="true" /> Public signup closed</span>
      </div>
    </div>
  );
}
