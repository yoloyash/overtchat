import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { expect, it } from "vitest";
import { useStableEvent } from "./useStableEvent";

it("keeps one identity and runs the handler from the latest render", () => {
  const { document, window } = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
  Object.assign(globalThis, { document, window, IS_REACT_ACT_ENVIRONMENT: true });
  const seen: Array<(suffix: string) => string> = [];

  function Probe({ name }: { name: string }) {
    const greet = useStableEvent((suffix: string) => `${name}${suffix}`);
    useEffect(() => {
      seen.push(greet);
    });
    return null;
  }

  const root = createRoot(document.getElementById("root") as unknown as HTMLElement);
  act(() => root.render(<Probe name="first" />));
  act(() => root.render(<Probe name="second" />));

  expect(seen[1]).toBe(seen[0]);
  expect(seen[0]("!")).toBe("second!");
  act(() => root.unmount());
});
