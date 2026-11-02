export function powershellCommand(script: string): string {
  return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
}

export function powershellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
