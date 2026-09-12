import { cancel, confirm, isCancel, note, select, text } from "@clack/prompts";
import {
  accessMode,
  additionalAddressValidation,
  addressValidation,
  connectionInstructions,
  lanHostValidation,
  portValidation,
} from "./access.js";
import { primaryLanAddress } from "./network.js";
import { checkServeRoute, detectTailscale } from "./tailscale.js";
import type { AccessConfig, AccessMode, InstallationConfig } from "./types.js";

function chosen<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("Setup cancelled.");
    process.exit(130);
  }
  return value;
}

async function retry(message: string): Promise<boolean> {
  note(message, "Tailscale setup");
  return chosen(
    await select({
      message: "Continue Tailscale setup?",
      options: [
        { value: true, label: "Retry" },
        { value: false, label: "Choose another access option" },
      ],
    }),
  );
}

export async function promptAccess(
  initial: InstallationConfig,
): Promise<InstallationConfig> {
  const currentMode = accessMode(initial);
  for (;;) {
    const mode = chosen(
      await select<AccessMode>({
        message: "Where do you want to access OvertChat?",
        initialValue: currentMode,
        options: [
          {
            value: "local",
            label: "Only on this computer",
            hint: "keep access local",
          },
          {
            value: "lan",
            label: "On my home network",
            hint: "phones and computers on the same network",
          },
          {
            value: "tailscale",
            label: "From anywhere with Tailscale",
            hint: "private access from devices on your Tailscale network",
          },
          {
            value: "advanced",
            label: "Advanced setup",
            hint: "use your own domain or reverse proxy",
          },
        ],
      }),
    );
    let hostname: string | undefined;
    if (mode === "tailscale") {
      for (;;) {
        const detected = await detectTailscale().catch(() => ({
          problem:
            "Could not contact Tailscale. Check that its service is running, then retry.",
        }));
        if ("hostname" in detected && detected.hostname) {
          hostname = detected.hostname;
          break;
        }
        if (!(await retry(detected.problem ?? "Tailscale is not ready.")))
          break;
      }
      if (!hostname) continue;
    }
    const access: AccessConfig = { mode };
    let appPort = initial.appPort;
    let publicUrl = `http://localhost:${appPort}`;
    let bindAddress = mode === "lan" ? "0.0.0.0" : "127.0.0.1";
    // Previously generated aliases are recreated for the selected address/port.
    let extraTrustedOrigins =
      mode === currentMode
        ? initial.extraTrustedOrigins.filter(
            (url) =>
              ![
                initial.publicUrl,
                `http://localhost:${initial.appPort}`,
                `http://127.0.0.1:${initial.appPort}`,
              ].includes(url),
          )
        : [];
    if (mode === "advanced") {
      publicUrl = new URL(
        chosen(
          await text({
            message: "What address will you use?",
            placeholder: "https://chat.example.com",
            initialValue:
              currentMode === "advanced" ? initial.publicUrl : undefined,
            validate: (value) => addressValidation(value, true),
          }),
        ).trim(),
      ).origin;
      access.proxy = chosen(
        await select({
          message: "How will you connect it?",
          initialValue: initial.access?.proxy ?? "cloudflare",
          options: [
            { value: "cloudflare", label: "Cloudflare Tunnel" },
            { value: "other", label: "Another reverse proxy" },
          ],
        }),
      );
      access.proxyLocation = chosen(
        await select({
          message: "Where does your tunnel or proxy run?",
          initialValue:
            initial.access?.proxyLocation ??
            (initial.bindAddress === "0.0.0.0" && currentMode === "advanced"
              ? "remote"
              : "host"),
          options: [
            { value: "host", label: "Directly on this computer" },
            {
              value: "docker",
              label: "In Docker on this computer",
              hint: "connect it to OvertChat's Docker network",
            },
            {
              value: "remote",
              label: "On another computer",
              hint: "allow connections to OvertChat over the network",
            },
          ],
        }),
      );
      if (access.proxyLocation === "remote") bindAddress = "0.0.0.0";
      access.connectionStatus = "pending";
    }
    const customize = chosen(
      await confirm({
        message: "Customize the port or additional addresses?",
        initialValue: false,
      }),
    );
    if (customize) {
      appPort = Number(
        chosen(
          await text({
            message: "OvertChat port",
            initialValue: String(appPort),
            validate: portValidation,
          }),
        ),
      );
    }
    if (mode === "local") {
      publicUrl = `http://localhost:${appPort}`;
      extraTrustedOrigins = [];
    }
    if (mode === "lan") {
      const currentHost = new URL(initial.publicUrl).hostname;
      const detected =
        initial.access?.lanAddress ??
        primaryLanAddress() ??
        (currentMode === "lan" && !lanHostValidation(currentHost)
          ? currentHost
          : null);
      const host =
        detected && !customize
          ? detected
          : chosen(
              await text({
                message: "This server's LAN address",
                initialValue: detected ?? undefined,
                placeholder: "192.168.1.20",
                validate: lanHostValidation,
              }),
            ).trim();
      if (customize || initial.access?.lanAddress || !detected)
        access.lanAddress = host;
      publicUrl = `http://${host}:${appPort}`;
      note(
        `Other devices on your network can use ${publicUrl}.\nThe app accepts network connections, subject to your firewall. Browser microphone access on other devices requires HTTPS; Tailscale provides an HTTPS option.`,
        "Home network access",
      );
    }
    if (mode === "tailscale") {
      let httpsPort = initial.access?.tailscaleRoute?.port ?? 443;
      let back = false;
      for (;;) {
        const route = {
          hostname: hostname!,
          port: httpsPort,
          target: `http://127.0.0.1:${appPort}`,
        };
        try {
          await checkServeRoute(route, initial.managedTailscaleRoute);
          access.tailscaleRoute = route;
          break;
        } catch (error) {
          note(
            error instanceof Error ? error.message : String(error),
            "Tailscale Serve",
          );
          const action = chosen(
            await select({
              message: "Continue with Tailscale Serve?",
              options: [
                { value: "port", label: "Use another HTTPS port" },
                { value: "retry", label: "Retry" },
                { value: "back", label: "Choose another access option" },
              ],
            }),
          );
          if (action === "back") {
            back = true;
            break;
          }
          if (action === "port")
            httpsPort = Number(
              chosen(
                await text({
                  message: "Tailscale HTTPS port",
                  initialValue: "8443",
                  validate: portValidation,
                }),
              ),
            );
        }
      }
      if (back) continue;
      publicUrl = `https://${hostname}${httpsPort === 443 ? "" : `:${httpsPort}`}`;
      access.connectionStatus = "pending";
      note(
        `OvertChat will configure private HTTPS access at ${publicUrl}.\nTailscale must allow this user to manage Serve. If needed, run sudo tailscale set --operator=<your-linux-username>.`,
        "Tailscale access",
      );
    }
    if (
      mode !== "local" &&
      (customize ||
        additionalAddressValidation(extraTrustedOrigins.join(","), publicUrl))
    ) {
      extraTrustedOrigins = chosen(
        await text({
          message: "Additional addresses (comma-separated, optional)",
          initialValue: extraTrustedOrigins.join(", "),
          validate: (value) => additionalAddressValidation(value, publicUrl),
        }),
      )
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => new URL(value).origin);
    }
    const config: InstallationConfig = {
      ...initial,
      access,
      appPort,
      bindAddress,
      publicUrl,
      extraTrustedOrigins,
      connectorServerUrl:
        initial.appPort === appPort
          ? initial.connectorServerUrl
          : `http://127.0.0.1:${appPort}`,
    };
    if (mode === "advanced")
      note(connectionInstructions(config), "Connect your address");
    return config;
  }
}
