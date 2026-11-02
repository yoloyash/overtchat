import "server-only";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
import type {
  Blockquote,
  Code,
  Heading,
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Table as MarkdownTable,
} from "mdast";
import { remark } from "remark";
import remarkGfm from "remark-gfm";

const BODY_FONT = "Calibri";
const CODE_FONT = "Courier New";
// Letter width less one-inch margins, in twentieths of a point.
const TEXT_WIDTH = 9_360;
const LIST_LEVELS = 6;

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

const BULLETS = ["•", "◦", "▪"];

interface Inline {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: boolean;
}

interface Block {
  /** Left indent of nested blockquotes, in twentieths of a point. */
  quote: number;
}

/**
 * Convert a Markdown document (CommonMark with GitHub tables, task lists,
 * strikethrough and footnotes) to a Word document. Content is mapped to
 * native Word headings, lists, tables and character formatting; images are
 * not fetched and appear as their alt text.
 */
export async function markdownToDocx(
  title: string,
  markdown: string,
): Promise<Uint8Array> {
  const tree = remark().use(remarkGfm).parse(markdown) as Root;
  let lists = 0;
  const footnotes = new Map<string, number>();

  function footnoteNumber(identifier: string): number {
    let number = footnotes.get(identifier);
    if (number === undefined) {
      number = footnotes.size + 1;
      footnotes.set(identifier, number);
    }
    return number;
  }

  function inline(nodes: PhrasingContent[], format: Inline): ParagraphChild[] {
    return nodes.flatMap((node): ParagraphChild[] => {
      switch (node.type) {
        case "text":
          return [run(node.value.replace(/\s*\n\s*/g, " "), format)];
        case "strong":
          return inline(node.children, { ...format, bold: true });
        case "emphasis":
          return inline(node.children, { ...format, italics: true });
        case "delete":
          return inline(node.children, { ...format, strike: true });
        case "inlineCode":
          return [run(node.value, { ...format, code: true })];
        case "break":
          return [new TextRun({ break: 1 })];
        case "link":
          return safeLink(node.url)
            ? [
                new ExternalHyperlink({
                  link: node.url,
                  children: inline(node.children, { ...format, link: true }) as TextRun[],
                }),
              ]
            : inline(node.children, format);
        case "image":
          return [run(`[Image${node.alt ? `: ${node.alt}` : ""}]`, { ...format, italics: true })];
        case "footnoteReference":
          return [
            new TextRun({
              text: `[${footnoteNumber(node.identifier)}]`,
              superScript: true,
              font: BODY_FONT,
            }),
          ];
        case "html":
          return [run(node.value, format)];
        default:
          return "children" in node
            ? inline(node.children as PhrasingContent[], format)
            : "value" in node && typeof node.value === "string"
              ? [run(node.value, format)]
              : [];
      }
    });
  }

  function paragraphs(nodes: RootContent[], block: Block): (Paragraph | Table)[] {
    return nodes.flatMap((node) => blockNode(node, block));
  }

  function quoteOptions(block: Block) {
    return block.quote
      ? {
          indent: { left: block.quote },
          border: {
            left: { style: BorderStyle.SINGLE, size: 12, color: "BFBFBF", space: 8 },
          },
        }
      : {};
  }

  function blockNode(node: RootContent, block: Block): (Paragraph | Table)[] {
    switch (node.type) {
      case "heading":
        return [heading(node, block)];
      case "paragraph":
        return [
          new Paragraph({
            children: inline(node.children, {}),
            spacing: { after: 120 },
            ...quoteOptions(block),
          }),
        ];
      case "blockquote":
        return blockquote(node, block);
      case "list":
        return list(node, 0, block);
      case "code":
        return [code(node, block)];
      case "table":
        return [table(node)];
      case "thematicBreak":
        return [
          new Paragraph({
            children: [],
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: "BFBFBF", space: 1 },
            },
            spacing: { after: 120 },
          }),
        ];
      case "html":
        return [new Paragraph({ children: [run(node.value, {})], ...quoteOptions(block) })];
      case "footnoteDefinition":
        return paragraphs(node.children, block).map((child, index) =>
          index === 0 && child instanceof Paragraph
            ? new Paragraph({
                children: [
                  new TextRun({
                    text: `[${footnoteNumber(node.identifier)}] `,
                    font: BODY_FONT,
                  }),
                  ...inline(
                    (node.children[0] as { children?: PhrasingContent[] }).children ?? [],
                    {},
                  ),
                ],
              })
            : child,
        );
      case "definition":
        return [];
      default:
        return "children" in node
          ? paragraphs(node.children as RootContent[], block)
          : [];
    }
  }

  function heading(node: Heading, block: Block): Paragraph {
    return new Paragraph({
      heading: HEADINGS[Math.min(node.depth, 6) - 1],
      children: inline(node.children, {}),
      ...quoteOptions(block),
    });
  }

  function blockquote(node: Blockquote, block: Block): (Paragraph | Table)[] {
    return paragraphs(node.children, { quote: block.quote + 720 });
  }

  function list(node: List, level: number, block: Block): (Paragraph | Table)[] {
    const instance = ++lists;
    return node.children.flatMap((item) => listItem(item, node, level, instance, block));
  }

  function listItem(
    item: ListItem,
    parent: List,
    level: number,
    instance: number,
    block: Block,
  ): (Paragraph | Table)[] {
    const depth = Math.min(level, LIST_LEVELS - 1);
    const checkbox =
      item.checked === true ? "☑ " : item.checked === false ? "☐ " : "";
    // Task items show their checkbox in place of a bullet.
    const marker =
      checkbox && !parent.ordered
        ? { indent: { left: 720 * (depth + 1), hanging: 360 } }
        : {
            numbering: parent.ordered
              ? { reference: "numbers", level: depth, instance }
              : { reference: "bullets", level: depth },
          };
    const out: (Paragraph | Table)[] = [];
    let first = true;
    for (const child of item.children) {
      if (child.type === "list") {
        out.push(...list(child, level + 1, block));
        continue;
      }
      if (first && child.type === "paragraph") {
        out.push(
          new Paragraph({
            ...marker,
            children: [
              ...(checkbox ? [run(checkbox, {})] : []),
              ...inline(child.children, {}),
            ],
            spacing: { after: parent.spread ? 120 : 40 },
          }),
        );
        first = false;
        continue;
      }
      // Continuation blocks align with the item text.
      out.push(
        ...paragraphs([child], { quote: block.quote + 720 * (depth + 1) }),
      );
      first = false;
    }
    if (first) {
      out.push(new Paragraph({ ...marker, children: checkbox ? [run(checkbox, {})] : [] }));
    }
    return out;
  }

  function code(node: Code, block: Block): Paragraph {
    const lines = node.value.split("\n");
    return new Paragraph({
      children: lines.map(
        (line, index) =>
          new TextRun({
            text: line,
            font: CODE_FONT,
            size: 19,
            break: index > 0 ? 1 : undefined,
          }),
      ),
      shading: { type: ShadingType.CLEAR, color: "auto", fill: "F2F2F2" },
      spacing: { before: 60, after: 160 },
      indent: block.quote ? { left: block.quote } : undefined,
    });
  }

  function table(node: MarkdownTable): Table {
    const columns = Math.max(1, ...node.children.map((row) => row.children.length));
    const width = Math.floor(TEXT_WIDTH / columns);
    const border = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
    return new Table({
      width: { size: TEXT_WIDTH, type: WidthType.DXA },
      columnWidths: Array.from({ length: columns }, () => width),
      borders: {
        top: border,
        bottom: border,
        left: border,
        right: border,
        insideHorizontal: border,
        insideVertical: border,
      },
      rows: node.children.map(
        (row, rowIndex) =>
          new TableRow({
            // An explicit false still writes the header flag.
            ...(rowIndex === 0 ? { tableHeader: true } : {}),
            children: Array.from({ length: columns }, (_, column) => {
              const cell = row.children[column];
              const align = node.align?.[column];
              return new TableCell({
                width: { size: width, type: WidthType.DXA },
                margins: { top: 60, bottom: 60, left: 100, right: 100 },
                shading:
                  rowIndex === 0
                    ? { type: ShadingType.CLEAR, color: "auto", fill: "F2F2F2" }
                    : undefined,
                children: [
                  new Paragraph({
                    alignment:
                      align === "center"
                        ? AlignmentType.CENTER
                        : align === "right"
                          ? AlignmentType.RIGHT
                          : AlignmentType.LEFT,
                    children: cell
                      ? inline(cell.children, rowIndex === 0 ? { bold: true } : {})
                      : [],
                  }),
                ],
              });
            }),
          }),
      ),
    });
  }

  const body = paragraphs(tree.children, { quote: 0 });
  const document = new Document({
    creator: "OvertChat",
    title,
    styles: {
      default: {
        document: { run: { font: BODY_FONT, size: 22 } },
      },
      characterStyles: [
        {
          id: "Hyperlink",
          name: "Hyperlink",
          run: { color: "0563C1", underline: { type: "single" } },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: Array.from({ length: LIST_LEVELS }, (_, level) => ({
            level,
            format: LevelFormat.BULLET,
            text: BULLETS[level % BULLETS.length],
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
        {
          reference: "numbers",
          levels: Array.from({ length: LIST_LEVELS }, (_, level) => ({
            level,
            format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3],
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children: body.length ? body : [new Paragraph({ children: [] })] }],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

function run(text: string, format: Inline): TextRun {
  return new TextRun({
    text,
    bold: format.bold,
    italics: format.italics,
    strike: format.strike,
    font: format.code ? CODE_FONT : BODY_FONT,
    ...(format.code
      ? { shading: { type: ShadingType.CLEAR, color: "auto", fill: "F2F2F2" } }
      : {}),
    ...(format.link ? { style: "Hyperlink" } : {}),
  });
}

function safeLink(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url);
}
