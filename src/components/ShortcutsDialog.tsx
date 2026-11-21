"use client";

import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  ResponsiveDialog,
  ResponsiveDialogCloseButton,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { modifierSymbol } from "@/lib/keyboard";

/** "mod" is the platform command key: ⌘ on Apple, Ctrl elsewhere. */
const SECTIONS: Array<{ title: string; shortcuts: Array<[string, string[]]> }> = [
  {
    title: "General",
    shortcuts: [
      ["Command palette", ["mod", "K"]],
      ["Search", ["/"]],
      ["Send feedback", ["!"]],
      ["Keyboard shortcuts", ["?"]],
    ],
  },
  {
    title: "Board",
    shortcuts: [
      ["New item", ["C"]],
      ["New list", ["⇧", "C"]],
      ["Filter", ["F"]],
      ["Notifications", ["N"]],
      ["Go to Brief", ["1"]],
      ["Go to Board", ["2"]],
      ["Go to Check-ins", ["3"]],
      ["Select item above or below", ["↑", "↓"]],
      ["Select in the next list", ["←", "→"]],
      ["…or, Vim-style", ["H", "J", "K", "L"]],
      ["Open selected item", ["↵"]],
    ],
  },
  {
    title: "Hovered, selected or open item",
    shortcuts: [
      ["Assign", ["A"]],
      ["Assign to me", ["I"]],
      ["Due date", ["D"]],
      ["Complete", ["X"]],
      ["Delete", ["⌫"]],
      ["Copy ref", ["mod", "."]],
    ],
  },
  {
    title: "Editing",
    shortcuts: [
      ["Save, or send a comment", ["mod", "↵"]],
      ["Cancel", ["esc"]],
    ],
  },
];

/** The ? shortcut's list of every keyboard shortcut. Send feedback is
 * listed only where this deployment takes feedback. */
export function ShortcutsDialog({
  open,
  onOpenChange,
  feedbackEnabled = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feedbackEnabled?: boolean;
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <ResponsiveDialogTitle>Keyboard shortcuts</ResponsiveDialogTitle>
          <ResponsiveDialogCloseButton className="ml-auto shrink-0" />
        </div>
        {/* Two columns on desktop, so the whole list fits without scrolling. */}
        <div className="grid min-h-0 flex-1 gap-x-8 gap-y-4 overflow-y-auto px-4 py-3 sm:grid-cols-2">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                {section.title}
              </h3>
              <dl>
                {section.shortcuts
                  .filter(([label]) => feedbackEnabled || label !== "Send feedback")
                  .map(([label, keys]) => (
                  <div key={label} className="flex items-center justify-between py-1 text-sm">
                    <dt>{label}</dt>
                    <dd>
                      <KbdGroup>
                        {keys.map((key) => (
                          <Kbd key={key}>{key === "mod" ? modifierSymbol() : key}</Kbd>
                        ))}
                      </KbdGroup>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
