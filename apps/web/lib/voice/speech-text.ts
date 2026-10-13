const referenceTypes = ["search", "image", "news", "video", "ref", "file"];
const escapePrefix = "\\ue20";
const markerCodes = "012346";
const completeReference = /^turn\{?\d+\}?(?:search|image|news|video|ref|file)\{?\d+\}?$/;

/** Whether an unfinished reference could still become a supported anchor. */
function referencePrefix(value: string): boolean {
  if ("turn".startsWith(value)) return true;
  if (!value.startsWith("turn")) return false;
  let rest = value.slice(4);
  if (rest.startsWith("{")) rest = rest.slice(1);
  if (!rest) return true;
  const turn = /^\d+/.exec(rest);
  if (!turn) return false;
  rest = rest.slice(turn[0].length);
  if (rest.startsWith("}")) rest = rest.slice(1);
  if (!rest) return true;
  for (const type of referenceTypes) {
    if (type.startsWith(rest)) return true;
    if (!rest.startsWith(type)) continue;
    const index = rest.slice(type.length);
    if (/^\{?\d*\}?$/.test(index)) return true;
  }
  return false;
}

/**
 * Append-only speech projection. Hold only an ambiguous escape/reference suffix,
 * never the full answer. Displayed and persisted messages retain their markers.
 */
export class SpeechTextFilter {
  private escape = "";
  private reference: string | null = null;

  push(delta: string): string {
    let output = "";
    for (const character of delta) {
      if (this.reference !== null) {
        const candidate = this.reference + character;
        // Bound malformed provider output; valid citation coordinates are tiny.
        if (candidate.length <= 256 && referencePrefix(candidate)) {
          this.reference = candidate;
          continue;
        }
        // Preserve ordinary text after a stray marker; only valid anchors are
        // discarded when a following character establishes their boundary.
        if (!completeReference.test(this.reference)) output += this.reference;
        this.reference = null;
      }
      if (this.escape) {
        const candidate = this.escape + character;
        if (escapePrefix.startsWith(candidate)) {
          this.escape = candidate;
          continue;
        }
        if (this.escape === escapePrefix && markerCodes.includes(character)) {
          this.escape = "";
          if (character === "2") this.reference = "";
          continue;
        }
        output += this.escape;
        this.escape = "";
      }
      if (character === "\\") this.escape = character;
      else if (/[\uE200-\uE204\uE206]/.test(character)) {
        if (character === "\uE202") this.reference = "";
      } else output += character;
    }
    return output;
  }

  finish(): string {
    // An incomplete citation escape at EOF must not be pronounced. A lone
    // backslash remains ordinary text; complete references were already held.
    const tail = this.escape === "\\" ? this.escape : "";
    this.escape = "";
    this.reference = null;
    return tail;
  }
}
