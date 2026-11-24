const KEY = "overtchat:signed-out";

/**
 * Remembers, for this tab, that the person chose to sign out, so the login
 * page doesn't send them straight back in through the identity provider.
 */
export function rememberSignedOut() {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    // Storage is unavailable: the login page then acts as on a first visit.
  }
}

export function signedOutHere(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function forgetSignedOut() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing was remembered.
  }
}
