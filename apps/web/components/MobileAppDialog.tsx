"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Tabs } from "@base-ui/react/tabs";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, ExternalLink, Smartphone, X } from "lucide-react";
import { writeText } from "clipboard-polyfill";
import {
  isLocalOnlyServer,
  parseMobileServerUrl,
} from "@overtchat/shared/mobile-connection";
import { Button, buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";

const stores = {
  ios: {
    name: "App Store",
    url: "https://apps.apple.com/us/app/overtchat/id6812165221",
  },
  android: {
    name: "Google Play",
    url: "https://play.google.com/store/apps/details?id=com.overtchat.mobile",
  },
};
const tabClass =
  "flex-1 rounded-md px-3 py-2 text-sm font-medium outline-none data-[active]:bg-background data-[active]:text-foreground data-[active]:shadow-sm focus-visible:ring-2 focus-visible:ring-ring";

export function MobileAppDialog({
  origin,
  onClose,
}: {
  origin: string;
  onClose: () => void;
}) {
  const [platform, setPlatform] = useState<keyof typeof stores>("ios");
  const [copied, setCopied] = useState(false);
  const server = parseMobileServerUrl(origin);
  const localOnly = server ? isLocalOnlyServer(server) : false;
  const store = stores[platform];

  async function copyAddress() {
    if (!server) return;
    try {
      await writeText(server);
      setCopied(true);
    } catch {
      toast.error({
        title: "Could not copy address",
        description: "Select and copy the server address manually.",
      });
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn(
            "fixed inset-0 z-50 bg-black/40",
            motionClasses.overlay,
          )}
        />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-[60] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
            motionClasses.dialog,
          )}
        >
          <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-muted">
            <Smartphone className="size-5" />
          </div>
          <Dialog.Title className="pr-6 text-lg font-semibold tracking-tight">
            OvertChat on your phone
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            Get the app or sign in on your phone.
          </Dialog.Description>
          <Dialog.Close
            render={
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-3 top-3"
              />
            }
            aria-label="Close mobile app dialog"
          >
            <X />
          </Dialog.Close>
          <Tabs.Root defaultValue="download" className="mt-5">
            <Tabs.List
              aria-label="Mobile app"
              className="flex rounded-lg bg-muted p-1 text-muted-foreground"
            >
              <Tabs.Tab value="download" className={tabClass}>
                Get the app
              </Tabs.Tab>
              <Tabs.Tab value="connect" className={tabClass}>
                Connect your phone
              </Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="download" className="pt-5 outline-none">
              <div
                role="group"
                aria-label="Phone platform"
                className="flex justify-center gap-2"
              >
                {(["ios", "android"] as const).map((value) => (
                  <Button
                    key={value}
                    variant={platform === value ? "secondary" : "ghost"}
                    size="sm"
                    aria-pressed={platform === value}
                    onClick={() => setPlatform(value)}
                  >
                    {value === "ios" ? "iOS" : "Android"}
                  </Button>
                ))}
              </div>
              <div className="flex flex-col items-center gap-4 pt-4">
                <div className="order-2 sm:order-1">
                  <QrCode
                    value={store.url}
                    label={`${store.name} download QR code`}
                  />
                </div>
                <a
                  href={store.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(buttonVariants(), "order-1 w-full sm:order-2")}
                >
                  Get it on {store.name}
                  <ExternalLink />
                </a>
                <p className="order-3 text-center text-sm text-muted-foreground">
                  Scan with your phone’s camera.
                </p>
              </div>
            </Tabs.Panel>
            <Tabs.Panel value="connect" className="space-y-4 pt-5 outline-none">
              <div className="space-y-2">
                <p className="text-sm font-medium">Server address</p>
                <div className="flex items-center gap-2">
                  <p
                    aria-label="Server address"
                    className="min-w-0 flex-1 select-text break-all text-sm text-muted-foreground"
                  >
                    {server ?? origin}
                  </p>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={!server || localOnly}
                    aria-label={
                      copied ? "Server address copied" : "Copy server address"
                    }
                    onClick={() => void copyAddress()}
                  >
                    {copied ? <Check /> : <Copy />}
                  </Button>
                </div>
                {localOnly && (
                  <p className="text-sm text-muted-foreground">
                    To use OvertChat on other devices, run{" "}
                    <code>overtchat setup</code> and choose{" "}
                    <strong className="font-medium text-foreground">
                      On my home network
                    </strong>
                    . Then open the network address shown.
                  </p>
                )}
              </div>
              {server && !localOnly && (
                <div className="flex flex-col items-center gap-3">
                  <QrCode value={server} label="Server connection QR code" />
                  <p className="text-sm text-muted-foreground">
                    Scan with OvertChat.
                  </p>
                </div>
              )}
            </Tabs.Panel>
          </Tabs.Root>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function QrCode({ value, label }: { value: string; label: string }) {
  return (
    <QRCodeSVG
      value={value}
      size={208}
      level="M"
      marginSize={4}
      bgColor="#ffffff"
      fgColor="#000000"
      role="img"
      aria-label={label}
      className="max-w-full rounded-lg border"
    />
  );
}
