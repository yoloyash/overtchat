import {
  File as FileIcon,
  FileCode,
  FileSpreadsheet,
  FileText,
} from "lucide-react";
import type { AttachmentCategory } from "@/lib/chat/attachments";

export function CategoryIcon({
  category,
  className,
}: {
  category: AttachmentCategory | undefined;
  className?: string;
}) {
  switch (category) {
    case "text":
      return <FileCode className={className} />;
    case "spreadsheet":
      return <FileSpreadsheet className={className} />;
    case "document":
      return <FileText className={className} />;
    default:
      return <FileIcon className={className} />;
  }
}

export function MediaIcon({
  mediaType,
  filename,
  className,
}: {
  mediaType: string | undefined;
  filename: string | undefined;
  className?: string;
}) {
  if (mediaType === "application/pdf")
    return <FileText className={className} />;
  if (mediaType?.includes("wordprocessingml"))
    return <FileText className={className} />;
  if (mediaType?.includes("spreadsheetml") || mediaType === "text/csv")
    return <FileSpreadsheet className={className} />;
  if (mediaType?.startsWith("text/"))
    return <FileCode className={className} />;
  if (
    filename &&
    /\.(md|json|yaml|yml|toml|py|js|ts|tsx|jsx|go|rs|java|c|cpp|h|sh|sql)$/i.test(
      filename,
    )
  ) {
    return <FileCode className={className} />;
  }
  return <FileIcon className={className} />;
}
