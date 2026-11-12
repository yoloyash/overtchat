"use client";

import { useMemo } from "react";
import { htmlPreviewDocument } from "@/lib/chat/code-preview";
import { MAX_TABLE_ROWS, parseDelimited } from "@/lib/chat/file-preview";

/** A CSV or TSV file as a table, with its first row as the header. */
export function DelimitedTable({ text, delimiter }: { text: string; delimiter: string }) {
  const rows = useMemo(() => parseDelimited(text, delimiter), [text, delimiter]);
  if (!rows.length) {
    return <p className="p-6 text-sm text-muted-foreground">This file is empty.</p>;
  }
  const [header, ...body] = rows;
  const shown = body.slice(0, MAX_TABLE_ROWS);
  const columns = Math.max(header.length, ...shown.map((row) => row.length));
  return (
    <div>
      <table className="w-full border-collapse text-xs" data-file-table="">
        <thead className="sticky top-0 bg-muted">
          <tr>
            {Array.from({ length: columns }, (_, column) => (
              <th key={column} className="border-b px-3 py-2 text-left font-medium whitespace-nowrap">
                {header[column] ?? ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, index) => (
            <tr key={index} className="border-b">
              {Array.from({ length: columns }, (_, column) => (
                <td key={column} className="px-3 py-1.5 whitespace-nowrap tabular-nums">
                  {row[column] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {body.length > shown.length && (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Showing the first {MAX_TABLE_ROWS.toLocaleString()} of {body.length.toLocaleString()} rows.
        </p>
      )}
    </div>
  );
}

/** An HTML file running in a sandboxed frame with no access to the app. */
export function HtmlFilePreview({ name, html }: { name: string; html: string }) {
  return (
    <iframe
      title={`${name} preview`}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={htmlPreviewDocument(html)}
      className="block size-full min-h-[24rem] border-0 bg-white"
    />
  );
}
