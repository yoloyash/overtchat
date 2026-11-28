import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useCallback, useRef, useState } from "react";
import { i18n } from "@overtchat/shared/i18n";
import { useTranslation } from "react-i18next";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { RenameSheet } from "@/components/ui/RenameSheet";
import { MoveToProjectSheet } from "@/components/drawer/MoveToProjectSheet";
import { useChatSession } from "@/lib/chat/session";
import {
  useDeleteChat,
  useMoveChat,
  useRenameChat,
  useSetChatPinned,
  type ChatListItem,
} from "@/lib/queries/chats";
import { useProjects } from "@/lib/queries/projects";
import { toastError, toastSuccess } from "@/lib/toast";

export type ChatActionTarget = Pick<
  ChatListItem,
  "id" | "title" | "pinned" | "projectId"
>;

/**
 * Rename, pin, move, and delete for one chat, with the confirmation sheets
 * they need. The drawer rows and the chat header kebab share this so both
 * surfaces behave identically. Render `sheets` once inside the host screen.
 */
export function useChatActions({
  onMoved,
}: {
  /** Runs after a move succeeds; the drawer uses it to reveal the new home. */
  onMoved?: (projectId: string | null) => void;
} = {}) {
  const { activeChatId, startNewChat } = useChatSession();
  const { t } = useTranslation();
  const { data: projects } = useProjects();

  const renameMutation = useRenameChat();
  const deleteMutation = useDeleteChat();
  const moveMutation = useMoveChat();
  const pinMutation = useSetChatPinned();

  const renameSheetRef = useRef<BottomSheetModal>(null);
  const deleteSheetRef = useRef<BottomSheetModal>(null);
  const moveSheetRef = useRef<BottomSheetModal>(null);
  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    title: string | null;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatActionTarget | null>(null);
  const [moveTarget, setMoveTarget] = useState<ChatActionTarget | null>(null);

  // Stable handlers: the chat header rebuilds its navigation options from
  // these, so a fresh identity per render would re-set options every time.
  const openRename = useCallback((item: ChatActionTarget) => {
    setRenameTarget({ id: item.id, title: item.title });
    renameSheetRef.current?.present();
  }, []);

  const openMove = useCallback((item: ChatActionTarget) => {
    setMoveTarget(item);
    moveSheetRef.current?.present();
  }, []);

  const openDeleteConfirm = useCallback((item: ChatActionTarget) => {
    setDeleteTarget(item);
    deleteSheetRef.current?.present();
  }, []);

  function submitRename(id: string, title: string) {
    renameMutation.mutate(
      { id, title },
      {
        onSuccess: () => toastSuccess(i18n.t("chat.mobile.actions.renamed")),
        onError: (e) => toastError(i18n.t("chat.mobile.actions.renameFailed"), e),
      },
    );
  }

  const { mutate: setPinned } = pinMutation;
  const togglePin = useCallback(
    (item: ChatActionTarget) => {
      setPinned(
        { id: item.id, pinned: !item.pinned },
        {
          onError: (error) =>
            toastError(
              item.pinned ? i18n.t("chat.mobile.actions.unpinFailed") : i18n.t("chat.mobile.actions.pinFailed"),
              error,
            ),
        },
      );
    },
    [setPinned],
  );

  function submitMove(projectId: string | null) {
    if (!moveTarget) return;
    if (moveTarget.projectId === projectId) return;
    const id = moveTarget.id;
    moveMutation.mutate(
      { id, projectId },
      {
        onSuccess: () => onMoved?.(projectId),
        onError: (e) => toastError(i18n.t("chat.mobile.actions.moveFailed"), e),
      },
    );
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    deleteMutation.mutate(target.id, {
      onSuccess: () => {
        if (activeChatId === target.id) {
          startNewChat(null);
        }
        toastSuccess(i18n.t("chat.mobile.actions.deletedTitle"));
      },
      onError: (e) => toastError(i18n.t("chat.mobile.actions.deleteFailed"), e),
    });
  }

  const sheets = (
    <>
      <RenameSheet
        ref={renameSheetRef}
        targetId={renameTarget?.id ?? null}
        initialTitle={renameTarget?.title ?? null}
        heading={t("chat.mobile.actions.renameTitle")}
        placeholder={t("chat.mobile.actions.renamePlaceholder")}
        onSubmit={submitRename}
      />
      <ConfirmSheet
        ref={deleteSheetRef}
        title={t("chat.mobile.actions.deleteDialogTitle")}
        message={
          deleteTarget?.title?.trim()
            ? t("chat.mobile.actions.deleteDialogNamed", { name: deleteTarget.title.trim() })
            : t("chat.mobile.actions.deleteDialogUnnamed")
        }
        confirmLabel={t("common.actions.delete")}
        destructive
        onConfirm={confirmDelete}
      />
      <MoveToProjectSheet
        ref={moveSheetRef}
        projects={projects ?? []}
        currentProjectId={moveTarget?.projectId ?? null}
        onSelect={submitMove}
      />
    </>
  );

  return {
    openRename,
    openMove,
    openDeleteConfirm,
    togglePin,
    pinPending: pinMutation.isPending,
    sheets,
  };
}
