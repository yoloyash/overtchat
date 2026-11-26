"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { authClient } from "@/lib/auth/client";
import { signInMethodsQuery } from "@/lib/queries/auth";
import {
  SettingsActions,
  SettingsNotice,
} from "../SettingsRows";

type Role = "user" | "admin";

export function AddUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { data: methods } = useQuery(signInMethodsQuery);
  // With passwords off, the account is found by its email at the provider.
  const provider = methods?.password === false ? methods.sso?.name : undefined;

  function reset() {
    setName("");
    setEmail("");
    setPassword("");
    setRole("user");
    setError("");
    setSubmitting(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    const { error } = await authClient.admin.createUser({
      email,
      ...(provider ? {} : { password }),
      name: name.trim(),
      role,
    });
    if (error) {
      setError(error.message ?? t("users.toast.createErrorFallback"));
      setSubmitting(false);
      return;
    }
    reset();
    onOpenChange(false);
    onCreated();
    toast.success({
      title: t("users.toast.createdTitle"),
      description: email,
    });
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn("fixed inset-0 z-40 bg-black/40", motionClasses.overlay)}
        />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
            motionClasses.dialog,
          )}
        >
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            {t("users.page.addUser")}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            {provider
              ? t("users.addDialog.ssoDescription", { provider })
              : t("users.addDialog.passwordDescription")}
          </Dialog.Description>

          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-name">{t("users.addDialog.nameLabel")}</Label>
              <Input
                id="new-name"
                type="text"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError("");
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-email">
                {t("users.addDialog.emailLabel")}
              </Label>
              <Input
                id="new-email"
                type="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError("");
                }}
              />
            </div>
            {!provider && (
              <div className="space-y-1.5">
                <Label htmlFor="new-password">
                  {t("users.addDialog.passwordLabel")}
                </Label>
                <Input
                  id="new-password"
                  type="text"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError("");
                  }}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="new-role">{t("users.addDialog.roleLabel")}</Label>
              <Select
                value={role}
                onValueChange={(next) => {
                  setRole(next as Role);
                  setError("");
                }}
              >
                <SelectTrigger
                  id="new-role"
                  aria-label={t("users.addDialog.roleAriaLabel")}
                  className="w-full"
                >
                  <SelectValue>{t(`users.roles.${role}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">{t("users.roles.user")}</SelectItem>
                  <SelectItem value="admin">
                    {t("users.roles.admin")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {error && <SettingsNotice tone="error">{error}</SettingsNotice>}

            <SettingsActions bordered={false} className="pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                {t("common.actions.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting
                  ? t("common.states.creating")
                  : t("common.actions.create")}
              </Button>
            </SettingsActions>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
