import Link from "next/link";
import type { ReactNode } from "react";

/**
 * PX-10 content model.
 *
 * Help, Legal, Support and Release Notes are CONTENT, not features — so they are
 * data, not markup. A page is a typed array of blocks; one renderer turns it
 * into accessible HTML. This is deliberate over MDX or a CMS (both out of scope):
 *
 *   • it is XSS-free by construction — no block carries raw HTML, links are
 *     rendered through next/link, so there is no dangerouslySetInnerHTML anywhere
 *     in the customer-facing surface;
 *   • it is TESTABLE — every internal link is a field, so the broken-link suite
 *     can walk the whole content tree and assert each href resolves to a real
 *     route (PX-10 verification: broken-link detection);
 *   • it is SEARCHABLE — the search index reads the same blocks, so search can
 *     never drift from what a page actually says.
 *
 * The prose measure and typography live in content.css; this file is structure
 * only. No block invents a capability — the words come from the certified PX-1
 * content guide, and the links point only at routes that exist.
 */

export interface InlineLink {
  readonly text: string;
  readonly href: string;
}

/** A paragraph is text with optional inline links spliced in by {0},{1}… markers. */
export interface RichText {
  readonly text: string;
  readonly links?: readonly InlineLink[];
}

export type Block =
  | { readonly kind: "heading"; readonly level: 2 | 3; readonly text: string; readonly id?: string }
  | { readonly kind: "paragraph"; readonly text: string; readonly links?: readonly InlineLink[] }
  | { readonly kind: "list"; readonly ordered?: boolean; readonly items: readonly RichText[] }
  | { readonly kind: "steps"; readonly items: readonly RichText[] }
  | {
      readonly kind: "callout";
      readonly tone: "info" | "warning" | "success";
      readonly text: string;
    }
  | { readonly kind: "definitions"; readonly items: readonly { term: string; def: string }[] };

/** Splice inline links into text at {0},{1}… placeholders. Unmatched markers render literally. */
function renderRich(text: string, links: readonly InlineLink[] = []): ReactNode {
  if (links.length === 0) {
    return text;
  }
  const parts = text.split(/(\{\d+\})/g);
  return parts.map((part, index) => {
    const match = /^\{(\d+)\}$/.exec(part);
    if (match === null) {
      return <span key={index}>{part}</span>;
    }
    const link = links[Number(match[1])];
    if (link === undefined) {
      return <span key={index}>{part}</span>;
    }
    return (
      <Link key={index} href={link.href} className="prose-link">
        {link.text}
      </Link>
    );
  });
}

/** Stable slug for a heading, so "In this article" anchors are deterministic. */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function Prose({ blocks }: { blocks: readonly Block[] }) {
  return (
    <div className="prose">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading": {
            const id = block.id ?? headingId(block.text);
            return block.level === 2 ? (
              <h2 key={index} id={id} className="prose-h2">
                {block.text}
              </h2>
            ) : (
              <h3 key={index} id={id} className="prose-h3">
                {block.text}
              </h3>
            );
          }
          case "paragraph":
            return (
              <p key={index} className="prose-p">
                {renderRich(block.text, block.links)}
              </p>
            );
          case "list":
            return block.ordered === true ? (
              <ol key={index} className="prose-ol">
                {block.items.map((item, i) => (
                  <li key={i}>{renderRich(item.text, item.links)}</li>
                ))}
              </ol>
            ) : (
              <ul key={index} className="prose-ul">
                {block.items.map((item, i) => (
                  <li key={i}>{renderRich(item.text, item.links)}</li>
                ))}
              </ul>
            );
          case "steps":
            return (
              <ol key={index} className="prose-steps">
                {block.items.map((item, i) => (
                  <li key={i}>
                    <span className="prose-step-num" aria-hidden>
                      {i + 1}
                    </span>
                    <span>{renderRich(item.text, item.links)}</span>
                  </li>
                ))}
              </ol>
            );
          case "callout":
            return (
              <div key={index} className={`prose-callout prose-callout-${block.tone}`} role="note">
                {block.text}
              </div>
            );
          case "definitions":
            return (
              <dl key={index} className="prose-dl">
                {block.items.map((item, i) => (
                  <div key={i} className="prose-dl-row">
                    <dt>{item.term}</dt>
                    <dd>{item.def}</dd>
                  </div>
                ))}
              </dl>
            );
        }
      })}
    </div>
  );
}

/** Extract the h2/h3 headings for an "In this article" table of contents. */
export function tocOf(
  blocks: readonly Block[],
): readonly { id: string; text: string; level: 2 | 3 }[] {
  return blocks
    .filter((block): block is Extract<Block, { kind: "heading" }> => block.kind === "heading")
    .map((block) => ({
      id: block.id ?? headingId(block.text),
      text: block.text,
      level: block.level,
    }));
}

/** The plain-text of a page, for the search index — one place, never drifts. */
export function plainTextOf(blocks: readonly Block[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
      case "paragraph":
      case "callout":
        out.push(block.text);
        break;
      case "list":
      case "steps":
        out.push(block.items.map((item) => item.text).join(" "));
        break;
      case "definitions":
        out.push(block.items.map((item) => `${item.term} ${item.def}`).join(" "));
        break;
    }
  }
  return out.join(" ");
}
