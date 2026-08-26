import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
import { gfmStrikethroughFromMarkdown } from "mdast-util-gfm-strikethrough";
import { gfmTaskListItemFromMarkdown } from "mdast-util-gfm-task-list-item";
import { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { gfmTaskListItem } from "micromark-extension-gfm-task-list-item";
import ReactMarkdown from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Plugin } from "unified";

type ParserData = {
  micromarkExtensions?: unknown[];
  fromMarkdownExtensions?: unknown[];
};

const limitedGfm: Plugin<[]> = function limitedGfm() {
  const data = this.data() as ParserData;
  const micromarkExtensions = data.micromarkExtensions ?? [];
  const fromMarkdownExtensions = data.fromMarkdownExtensions ?? [];
  data.micromarkExtensions = micromarkExtensions;
  data.fromMarkdownExtensions = fromMarkdownExtensions;
  micromarkExtensions.push(
    gfmAutolinkLiteral(),
    gfmStrikethrough({ singleTilde: false }),
    gfmTaskListItem(),
  );
  fromMarkdownExtensions.push(
    gfmAutolinkLiteralFromMarkdown(),
    gfmStrikethroughFromMarkdown(),
    gfmTaskListItemFromMarkdown(),
  );
};

const safeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), "target", "rel"],
    input: ["type", "checked", "disabled"],
    li: ["className"],
    ul: ["className"],
  },
};

export function MarkdownPreview({ source }: { source: string }) {
  if (!source.trim()) return <p className="markdown-empty">Nothing to preview.</p>;
  return (
    <div className="markdown-preview">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[limitedGfm]}
        rehypePlugins={[[rehypeSanitize, safeSchema]]}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
