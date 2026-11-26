import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { failureText } from "./failure-reason";
import { hostOf, shell } from "./shell";
import type { LocalServer } from "../shared/ipc";
import { DesktopUpdateAction } from "@/components/DesktopUpdateAction";

export function ConnectScreen({ lastAddress }: { lastAddress: string }) {
  const { t } = useTranslation();
  const [address, setAddress] = useState(lastAddress);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [localServers, setLocalServers] = useState<LocalServer[]>([]);
  const [discovering, setDiscovering] = useState(true);
  const [discoveryAttempt, setDiscoveryAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setDiscovering(true);
    void shell.discoverLocalServers().catch(() => []).then((servers) => {
      if (!active) return;
      setLocalServers(servers);
      setDiscovering(false);
    });
    return () => { active = false; };
  }, [discoveryAttempt]);

  async function connect(target: string) {
    setConnecting(true);
    setError("");
    try {
      const result = await shell.connect(target);
      if (!result.ok) {
        setError(failureText(result, t));
        return;
      }
      window.location.reload();
    } catch {
      setError(t("app.desktopShell.connect.errors.connectFailed"));
    } finally {
      setConnecting(false);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!address.trim()) {
      setError(t("app.desktopShell.connect.errors.addressRequired"));
      return;
    }
    await connect(address);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <header>
        <h1 className="text-xl font-semibold tracking-tight">
          {t("app.desktopShell.connect.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("app.desktopShell.connect.description")}
        </p>
      </header>

      <section aria-label={t("app.desktopShell.connect.localRegionLabel")} className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{t("app.desktopShell.connect.localTitle")}</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={discovering || connecting}
            onClick={() => {
              setError("");
              setDiscoveryAttempt((attempt) => attempt + 1);
            }}
          >
            {t("app.desktopShell.connect.checkAgain")}
          </Button>
        </div>
        <div role="status" className="text-sm text-muted-foreground">
          {discovering
            ? t("app.desktopShell.connect.looking")
            : localServers.length === 0
              ? t("app.desktopShell.connect.noneFound")
              : t("app.desktopShell.connect.found")}
        </div>
        <ul className="space-y-2">
          {localServers.map((server) => (
            <li key={server.origin} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0 text-sm">
                <p className="truncate font-medium">{hostOf(server.origin)}</p>
                {server.version && <p className="text-muted-foreground">{t("app.desktopShell.connect.serverVersion", { version: server.version })}</p>}
                {server.problem?.kind === "server-outdated" && <p className="text-muted-foreground">{t("app.desktopShell.connect.serverUpdateRequired")}</p>}
                {server.problem?.kind === "app-outdated" && <p className="text-muted-foreground">{t("app.desktopShell.connect.desktopUpdateRequired")}</p>}
              </div>
              <Button type="button" size="sm" disabled={connecting} onClick={() => {
                setAddress(server.origin);
                void connect(server.origin);
              }}>
                {t("app.desktopShell.connect.connectAction")}
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <div className="space-y-1.5">
        <Label htmlFor="address">{t("app.desktopShell.connect.addressLabel")}</Label>
        <Input
          id="address"
          type="text"
          inputMode="url"
          placeholder="chat.example.com"
          autoComplete="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          value={address}
          disabled={connecting}
          aria-invalid={!!error}
          onChange={(event) => {
            setAddress(event.target.value);
            setError("");
          }}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" disabled={connecting} className="w-full">
        {connecting ? t("app.desktopShell.connecting") : t("app.desktopShell.connect.continue")}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        <Trans
          i18nKey="app.desktopShell.connect.noServerYet"
          components={{
            setup: (
              <a
                href="https://overtchat.com"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              />
            ),
          }}
        />
      </p>
      <div className="text-center">
        <DesktopUpdateAction alwaysVisible />
      </div>
    </form>
  );
}
