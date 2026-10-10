import { Fragment } from "react";
import { parseMarkdown, type Inline } from "@/lib/markdown";

function Inlines({ inlines }: { inlines: Inline[] }) {
  return inlines.map((inline, i) => {
    let node: React.ReactNode = inline.text;
    if (inline.bold) node = <strong>{node}</strong>;
    if (inline.italic) node = <em>{node}</em>;
    if (inline.href) {
      node = (
        <a href={inline.href} target="_blank" rel="noopener noreferrer">
          {node}
        </a>
      );
    }
    return <Fragment key={i}>{node}</Fragment>;
  });
}

export function MarkdownView({ markdown }: { markdown: string }) {
  const blocks = parseMarkdown(markdown);
  return (
    <div className="doc text-sm">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "heading": {
            const Tag = `h${block.level}` as const;
            return (
              <Tag key={i}>
                <Inlines inlines={block.inlines} />
              </Tag>
            );
          }
          case "paragraph":
            return (
              <p key={i}>
                <Inlines inlines={block.inlines} />
              </p>
            );
          case "rule":
            return <hr key={i} />;
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inlines inlines={item} />
                  </li>
                ))}
              </List>
            );
          }
        }
      })}
    </div>
  );
}
