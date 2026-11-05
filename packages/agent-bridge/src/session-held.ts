/**
 * A resume that stops because the provider's own process still owns the
 * session. The connector reports it as plain error text, so the phrase below
 * is the contract the web app matches to stop retrying the open.
 */
const HELD_ELSEWHERE_PHRASE = "is still open in another";

export function agentSessionHeldElsewhereMessage(providerLabel: string): string {
  return `This session ${HELD_ELSEWHERE_PHRASE} ${providerLabel} process, such as its terminal UI. Close it there, then open it here.`;
}

export function isAgentSessionHeldElsewhereMessage(message: string): boolean {
  return message.includes(HELD_ELSEWHERE_PHRASE);
}
