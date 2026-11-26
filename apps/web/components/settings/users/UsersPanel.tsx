"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import { useFormatLocale } from "@/components/I18nProvider";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { KeyRound, Plus, ShieldOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth/client";
import { signInMethodsQuery } from "@/lib/queries/auth";
import {
  useInvalidateUsers,
  useSetUserRole,
  useUsers,
} from "@/lib/queries/users";
import type { UserRole, UserRow } from "@/lib/queries/users";
import { motionClasses } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  SettingsNotice,
  SettingsPage,
  SettingsPageHeader,
  SettingsSection,
} from "../SettingsRows";
import { AddUserDialog } from "./AddUserDialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";
import { ResetTwoFactorDialog } from "./ResetTwoFactorDialog";

type PendingRoleChange = {
  user: UserRow;
  role: UserRole;
};

export function UsersPanel({ currentUserId }: { currentUserId: string }) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const { data: users = [] } = useUsers();
  const invalidateUsers = useInvalidateUsers();
  const setRoleMutation = useSetUserRole();
  // With passwords off there is nothing to reset; accounts sign in elsewhere.
  const { data: methods } = useQuery(signInMethodsQuery);
  const passwords = methods?.password !== false;
  const [addOpen, setAddOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [twoFactorTarget, setTwoFactorTarget] = useState<UserRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<UserRow | null>(null);
  const [pendingRoleChange, setPendingRoleChange] =
    useState<PendingRoleChange | null>(null);
  const [roleError, setRoleError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!pendingDelete || pendingDelete.id === currentUserId) return;
    const email = pendingDelete.email;
    setDeleting(true);
    setDeleteError("");
    const { error } = await authClient.admin.removeUser({
      userId: pendingDelete.id,
    });
    if (error) {
      setDeleteError(error.message ?? t("users.toast.deleteErrorFallback"));
      setDeleting(false);
      return;
    }
    invalidateUsers();
    setPendingDelete(null);
    setDeleting(false);
    toast.success({
      title: t("users.toast.deletedTitle"),
      description: email,
    });
  }

  async function confirmRoleChange() {
    if (!pendingRoleChange) return;
    setRoleError("");
    try {
      await setRoleMutation.mutateAsync({
        userId: pendingRoleChange.user.id,
        role: pendingRoleChange.role,
      });
      toast.success({
        title:
          pendingRoleChange.role === "admin"
            ? t("users.toast.adminGrantedTitle")
            : t("users.toast.adminRemovedTitle"),
        description: pendingRoleChange.user.email,
      });
      setPendingRoleChange(null);
    } catch (cause) {
      setRoleError(
        cause instanceof Error
          ? cause.message
          : t("users.toast.roleChangeErrorFallback"),
      );
    }
  }

  return (
    <SettingsPage>
      <SettingsPageHeader
        title={t("users.page.title")}
        description={t("users.page.description")}
        action={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus /> {t("users.page.addUser")}
          </Button>
        }
      />

      <SettingsSection
        title={t("users.list.title")}
        description={t("users.list.configured", { count: users.length })}
        contentClassName="overflow-x-auto divide-y-0"
      >
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="border-b bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium">
                {t("users.list.columns.name")}
              </th>
              <th className="px-3 py-2.5 text-left font-medium">
                {t("users.list.columns.email")}
              </th>
              <th className="px-3 py-2.5 text-left font-medium">
                {t("users.list.columns.role")}
              </th>
              <th className="px-3 py-2.5 text-left font-medium">
                {t("users.list.columns.twoFactor")}
              </th>
              <th className="px-3 py-2.5 text-left font-medium">
                {t("users.list.columns.created")}
              </th>
              <th className="px-3 py-2.5 text-right font-medium">
                {t("users.list.columns.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b last:border-0">
                <td className="px-3 py-3 font-medium text-foreground">
                  {u.name}
                </td>
                <td className="px-3 py-3 text-muted-foreground">{u.email}</td>
                <td className="px-3 py-3">
                  {u.id === currentUserId ? (
                    <span className="text-muted-foreground">
                      {t(`users.roles.${normalizeRole(u.role)}`)}
                    </span>
                  ) : (
                    <Select
                      value={normalizeRole(u.role)}
                      disabled={setRoleMutation.isPending}
                      onValueChange={(next) => {
                        const role = next as UserRole;
                        if (role === normalizeRole(u.role)) return;
                        setRoleError("");
                        setPendingRoleChange({ user: u, role });
                      }}
                    >
                      <SelectTrigger
                        aria-label={t("users.list.roleForLabel", {
                          email: u.email,
                        })}
                        className="w-28"
                      >
                        <SelectValue>
                          {t(`users.roles.${normalizeRole(u.role)}`)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">
                          {t("users.roles.user")}
                        </SelectItem>
                        <SelectItem value="admin">
                          {t("users.roles.admin")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {u.twoFactorEnabled
                    ? t("users.list.twoFactorOn")
                    : t("users.list.twoFactorOff")}
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {new Date(u.createdAt).toLocaleDateString(locale)}
                </td>
                <td className="px-3 py-3 text-right">
                  {u.id === currentUserId ? (
                    <span className="text-xs text-muted-foreground">
                      {t("users.list.currentUser")}
                    </span>
                  ) : (
                    <div className="flex justify-end gap-1">
                      {passwords && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setResetTarget(u)}
                        >
                          <KeyRound data-icon="inline-start" />{" "}
                          {t("users.list.resetPassword")}
                        </Button>
                      )}
                      {u.twoFactorEnabled && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setTwoFactorTarget(u)}
                        >
                          <ShieldOff data-icon="inline-start" />{" "}
                          {t("users.list.resetTwoFactor")}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDeleteError("");
                          setPendingDelete(u);
                        }}
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 data-icon="inline-start" />
                        {t("common.actions.delete")}
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SettingsSection>

      <AddUserDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={invalidateUsers}
      />
      {twoFactorTarget && (
        <ResetTwoFactorDialog
          key={twoFactorTarget.id}
          target={twoFactorTarget}
          onClose={() => setTwoFactorTarget(null)}
          onReset={invalidateUsers}
        />
      )}
      {resetTarget && (
        <ResetPasswordDialog
          key={resetTarget.id}
          target={resetTarget}
          onClose={() => setResetTarget(null)}
        />
      )}

      <AlertDialog.Root
        open={pendingRoleChange !== null}
        onOpenChange={(next) => {
          if (!next && !setRoleMutation.isPending) {
            setPendingRoleChange(null);
            setRoleError("");
          }
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop
            className={cn(
              "fixed inset-0 z-40 bg-black/40",
              motionClasses.overlay,
            )}
          />
          <AlertDialog.Popup
            className={cn(
              "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
              motionClasses.dialog,
            )}
          >
            <AlertDialog.Title className="text-base font-semibold tracking-tight">
              {pendingRoleChange?.role === "admin"
                ? t("users.roleDialog.grantTitle")
                : t("users.roleDialog.removeTitle")}
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              <Trans
                i18nKey={
                  pendingRoleChange?.role === "admin"
                    ? "users.roleDialog.grantDescription"
                    : "users.roleDialog.removeDescription"
                }
                values={{ email: pendingRoleChange?.user.email ?? "" }}
                components={{
                  email: <span className="font-medium text-foreground" />,
                }}
              />
            </AlertDialog.Description>
            {roleError && (
              <SettingsNotice tone="error" className="mt-3 text-xs">
                {roleError}
              </SettingsNotice>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={setRoleMutation.isPending}
                  />
                }
              >
                {t("common.actions.cancel")}
              </AlertDialog.Close>
              <Button
                size="sm"
                disabled={setRoleMutation.isPending}
                onClick={() => void confirmRoleChange()}
              >
                {setRoleMutation.isPending
                  ? t("common.states.updating")
                  : pendingRoleChange?.role === "admin"
                    ? t("users.roleDialog.makeAdmin")
                    : t("users.roleDialog.makeUser")}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <AlertDialog.Root
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next && !deleting) {
            setPendingDelete(null);
            setDeleteError("");
          }
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop
            className={cn(
              "fixed inset-0 z-40 bg-black/40",
              motionClasses.overlay,
            )}
          />
          <AlertDialog.Popup
            className={cn(
              "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
              motionClasses.dialog,
            )}
          >
            <AlertDialog.Title className="text-base font-semibold tracking-tight">
              {t("users.deleteDialog.title")}
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              <Trans
                i18nKey="users.deleteDialog.description"
                values={{ email: pendingDelete?.email ?? "" }}
                components={{
                  email: <span className="font-medium text-foreground" />,
                }}
              />
            </AlertDialog.Description>
            {deleteError && (
              <SettingsNotice tone="error" className="mt-3 text-xs">
                {deleteError}
              </SettingsNotice>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close
                render={
                  <Button variant="ghost" size="sm" disabled={deleting} />
                }
              >
                {t("common.actions.cancel")}
              </AlertDialog.Close>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleting}
                onClick={confirmDelete}
              >
                {deleting
                  ? t("common.states.deleting")
                  : t("common.actions.delete")}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </SettingsPage>
  );
}

function normalizeRole(role: string | null | undefined): UserRole {
  return role === "admin" ? "admin" : "user";
}
