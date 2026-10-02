/** The bundled UI must match the selected server, including after restart. */
export function updateCompatibilityMessage(candidate: unknown, serverApiLevel: number): string | null {
  if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 1) {
    throw new Error("The desktop update is missing valid compatibility information. Try again later.");
  }
  if (candidate > serverApiLevel) {
    return "This desktop update needs a newer server. Update your OvertChat server first, or ask its administrator, then check for desktop updates again.";
  }
  if (candidate < serverApiLevel) {
    return "The latest desktop release does not support this server yet. Check again after a compatible desktop release is available.";
  }
  return null;
}
