import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AssigneeView } from "@/core/members";
import { type MdNode, replaceMentions } from "@/lib/mentions";

const codeClassName =
  "rounded bg-neutral-100 px-1 py-0.5 font-mono text-[0.85em] text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100";

// Element styling lives here rather than relying on a `prose` plugin — the app
// deliberately stays lightweight and doesn't pull in @tailwindcss/typography.
// Classes lean on the same muted neutral palette the rest of the dialog uses.
const components: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => (
    <h1 className="mb-2 mt-3 text-base font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-3 text-sm font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h3>
  ),
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-blue-600 underline underline-offset-2 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-neutral-800 dark:text-neutral-100">
      {children}
    </strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => <code className={codeClassName}>{children}</code>,
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md bg-neutral-100 p-3 text-[0.85em] first:mt-0 last:mb-0 dark:bg-neutral-800">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-neutral-300 pl-3 text-neutral-500 first:mt-0 last:mb-0 dark:border-neutral-600 dark:text-neutral-400">
      {children}
    </blockquote>
  ),
  hr: () => (
    <hr className="my-3 border-neutral-200 dark:border-neutral-700" />
  ),
};

/** Someone an `@username` can mention. */
export type MentionPerson = Pick<AssigneeView, "username" | "displayUsername" | "name">;

const mentionClassName =
  "rounded bg-blue-50 px-0.5 font-medium text-blue-700 dark:bg-blue-950/60 dark:text-blue-300";

// Turns each `@username` of someone in `people` into a highlighted span named
// as they write it, found as the server finds whom to notify.
function remarkMentions(people: MentionPerson[]) {
  const byHandle = new Map(people.flatMap((p) => (p.username ? [[p.username, p]] : [])));
  return () => (tree: MdNode) =>
    replaceMentions(
      tree,
      (handle) => byHandle.get(handle.toLowerCase()),
      (person) => ({
        type: "mention",
        data: {
          hName: "span",
          hProperties: { className: mentionClassName, title: person.name ?? "" },
        },
        children: [{ type: "text", value: `@${person.displayUsername ?? person.username}` }],
      }),
    );
}

// Renders a markdown string with GitHub-flavored extensions (tables, task
// lists, strikethrough, autolinks). Block-level margins collapse at the edges
// so it sits flush inside a field. `mentions` highlights `@username` for each
// of those people, as in comments.
export function Markdown({
  children,
  mentions,
}: {
  children: string;
  mentions?: MentionPerson[];
}) {
  return (
    <ReactMarkdown
      remarkPlugins={mentions?.length ? [remarkGfm, remarkMentions(mentions)] : [remarkGfm]}
      components={components}
    >
      {children}
    </ReactMarkdown>
  );
}

// Renders text with only `backtick` spans interpreted as inline code —
// everything else stays literal. For constrained fields like the title where
// full markdown would be too much but inline code is still useful.
export function InlineCode({ children }: { children: string }) {
  // Split on balanced backtick pairs, keeping the delimiters so we can tell
  // code spans apart from the surrounding text. An unmatched backtick is left
  // in a plain segment and renders literally.
  const parts = children.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.length > 1 && part.startsWith("`") && part.endsWith("`") ? (
          <code key={i} className={codeClassName}>
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}
