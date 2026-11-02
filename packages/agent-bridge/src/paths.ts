/** Host paths are validated without using the web server's operating system. */
export function isAbsoluteAgentPath(value: string): boolean {
  if (!value || /[\0\r\n]/u.test(value)) return false;
  if (/^[A-Za-z]:[\\/]/u.test(value)) return true;
  // UNC paths must identify both a server and a share. Device namespaces are
  // not workspace paths (for example \\.\pipe and \\?\GLOBALROOT).
  if (/^[\\/]{2}/u.test(value)) {
    return /^[\\/]{2}(?![.?][\\/])[^\\/?]+[\\/][^\\/]+(?:[\\/]|$)/u.test(value);
  }
  return value.startsWith("/");
}
