/*

 */

"use client";

/**
 * SOURCE OF TRUTH KEYWORDS: CodeBlock, A_SNIPPET_NOBODY_CAN_COPY_IS_PROSE,
 *   CLIPBOARD_CAN_REFUSE, THEME_TOKENS_ONLY, COPY_IS_THE_ONLY_BEHAVIOUR
 *
 * WHAT:  A block of code or configuration with a copy button, a caption and an
 *        optional filename.
 *
 * WHY:   A_SNIPPET_NOBODY_CAN_COPY_IS_PROSE. The developers screen and the API
 *        reference both exist to be copied FROM — a curl command, an MCP
 *        config, an endpoint URL. A `<pre>` a customer has to select by hand
 *        across a scrolling region is one they will retype and typo, and the
 *        difference between "we have an API" and somebody calling it is
 *        usually that one button.
 *
 *        CLIPBOARD_CAN_REFUSE, which is the half most copy buttons get wrong.
 *        `navigator.clipboard` throws on an insecure origin and when the
 *        permission is denied, and a button that silently did nothing while
 *        looking like it worked is worse than no button: the customer pastes
 *        whatever was in the clipboard before. So the failure is SAID, and the
 *        text stays selectable as the fallback it already was.
 *
 *        COPY_IS_THE_ONLY_BEHAVIOUR. No syntax highlighting, no language
 *        parsing, no highlighter dependency — `language` is a label on the
 *        header, not a parser. Highlighting a JSON block is a megabyte of
 *        JavaScript to make something prettier that was already legible, and
 *        this component is rendered on a public page where the cost is paid by
 *        every visitor.
 *
 *        THEME_TOKENS_ONLY — `bg-muted`, `border`, `text-muted-foreground`,
 *        so the same block reads correctly in both themes and inside the
 *        dashboard chrome as well as on a marketing page.
 *
 *        Globalized in `components/global/` because it is used by two route
 *        groups — `(dashboard)` and `(marketing)` — which is the test
 *        CLAUDE.md rule 7 sets for a global component. Everything variable is
 *        a prop; it hardcodes no copy and no layout of its own.
 * WHERE: The developers screen's curl and MCP blocks, and every snippet on
 *        /docs/api.
 */

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CodeBlockProps {
  /** The text, copied verbatim. */
  code: string;
  /**
   * A label for the header — `json`, `bash`, `http`. A LABEL, not a parser
   * hint: see COPY_IS_THE_ONLY_BEHAVIOUR.
   */
  language?: string;
  /**
   * Where this belongs, when that is the point — `~/.cursor/mcp.json`. Shown
   * instead of the language when both are given, because a path tells a
   * reader more than a format does.
   */
  filename?: string;
  /** One sentence under the block. */
  caption?: React.ReactNode;
  /** What the toast says on success. */
  copyLabel?: string;
  className?: string;
}

export function CodeBlock({
  code,
  language,
  filename,
  caption,
  copyLabel = "Copied.",
  className,
}: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false);

  /* The tick reverts on its own, so a second copy of the same block still
   * gives feedback. Cleared on unmount because the block may be inside a
   * dialog that closes first. */
  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(copyLabel);
    } catch {
      /* CLIPBOARD_CAN_REFUSE — say so, and point at the fallback that was
       * always there. */
      toast.error("Could not copy. Select the text and copy it manually.");
    }
  };

  const heading = filename ?? language;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="bg-muted min-w-0 overflow-hidden rounded-md border">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
          <span className="text-muted-foreground truncate font-mono text-xs">
            {heading ?? ""}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2 text-xs"
            onClick={() => void copy()}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
          <code className="font-mono">{code}</code>
        </pre>
      </div>
      {caption !== undefined && (
        <p className="text-muted-foreground text-sm">{caption}</p>
      )}
    </div>
  );
}
