"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Extension, markInputRule, markPasteRule, useEditor, useEditorState, type Editor, type Mark } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Bold from "@tiptap/extension-bold";
import Italic from "@tiptap/extension-italic";
import Strike from "@tiptap/extension-strike";
import { Placeholder } from "@tiptap/extensions";
import { toEditorHtml, toMrkdwn } from "@/lib/format";
import { Icon, type IconName } from "../icons";

// WYSIWYG composer that reads and writes the same mrkdwn stored in messages.body (see lib/format.ts)

// Slack's markers: *bold* _italic_ ~strike~ (Tiptap defaults to **bold** *italic* ~~strike~~)
const markRule = (ch: string) => {
  const c = `\\${ch}`;
  return {
    input: new RegExp(`(?:^|\\s)(${c}(?!\\s+${c})([^${c}]+)${c}(?!\\s+${c}))$`),
    paste: new RegExp(`(?:^|\\s)(${c}(?!\\s+${c})([^${c}]+)${c}(?!\\s+${c}))`, "g"),
  };
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const slackMark = (ext: Mark<any>, ch: string) =>
  ext.extend({
    addInputRules() {
      return [markInputRule({ find: markRule(ch).input, type: this.type })];
    },
    addPasteRules() {
      return [markPasteRule({ find: markRule(ch).paste, type: this.type })];
    },
  });

// FormatBar registers how to open its link form so the keyboard shortcut can reach it
const linkOpeners = new WeakMap<Editor, () => void>();

const emptyBlock = (e: Editor) => e.state.selection.empty && e.state.selection.$from.parent.content.size === 0;

const SlackKeys = Extension.create({
  name: "slackKeys",
  priority: 1000,
  addKeyboardShortcuts() {
    const e = this.editor;
    return {
      "Mod-Shift-x": () => e.commands.toggleStrike(),
      "Mod-Shift-c": () => e.commands.toggleCode(),
      "Mod-Shift-9": () => e.commands.toggleBlockquote(),
      "Mod-Shift-u": () => {
        linkOpeners.get(e)?.();
        return true;
      },
      // Enter sends, so Shift+Enter is the new line: next list item, out of an empty item or quote, else a new paragraph
      "Shift-Enter": () =>
        e.commands.first(({ commands }) => [
          () => commands.newlineInCode(),
          () => e.isActive("listItem") && emptyBlock(e) && commands.liftListItem("listItem"),
          () => commands.splitListItem("listItem"),
          () => e.isActive("blockquote") && emptyBlock(e) && commands.lift("blockquote"),
          () => commands.splitBlock(),
        ]),
    };
  },
});

// Hook ------------------------------------------------------------------------------------------

type Options = {
  initial: string;
  placeholder?: string;
  autoFocus?: boolean;
  onChange?: (md: string, editor: Editor) => void;
  onCaret?: (editor: Editor) => void;
  // Runs before the editor's own keys; return true to swallow the key
  onKeyDown?: (e: KeyboardEvent) => boolean;
  onFiles?: (files: File[]) => void;
};

export function useRichEditor(opts: Options) {
  const cb = useRef(opts);
  useLayoutEffect(() => {
    cb.current = opts;
  });
  const [content] = useState(() => toEditorHtml(opts.initial));
  return useEditor(
    {
      immediatelyRender: false,
      autofocus: opts.autoFocus ? "end" : false,
      content,
      extensions: [
        StarterKit.configure({
          bold: false,
          italic: false,
          strike: false,
          heading: false,
          horizontalRule: false,
          underline: false,
          trailingNode: false,
          link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["http", "https"] },
        }),
        slackMark(Bold, "*"),
        slackMark(Italic, "_"),
        slackMark(Strike, "~"),
        SlackKeys,
        Placeholder.configure({ placeholder: opts.placeholder ?? "" }),
      ],
      editorProps: {
        handleKeyDown: (_view, e) => cb.current.onKeyDown?.(e) ?? false,
        handlePaste: (_view, e) => {
          const files = Array.from(e.clipboardData?.files ?? []);
          if (!files.length || !cb.current.onFiles) return false;
          cb.current.onFiles(files);
          return true;
        },
        // Dropped files bubble up to the composer; don't let the editor try to insert them
        handleDrop: (_view, e) => !!(e as DragEvent).dataTransfer?.files.length,
      },
      onUpdate: ({ editor }) => {
        cb.current.onChange?.(toMrkdwn(editor.getJSON()), editor);
        cb.current.onCaret?.(editor);
      },
      onSelectionUpdate: ({ editor }) => cb.current.onCaret?.(editor),
    },
    [],
  );
}

// Toolbar ---------------------------------------------------------------------------------------

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export function FormatBar({ editor }: { editor: Editor }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      Object.fromEntries(["bold", "italic", "strike", "link", "orderedList", "bulletList", "blockquote", "code", "codeBlock"].map((n) => [n, e.isActive(n)])),
  });

  useEffect(() => {
    linkOpeners.set(editor, () => {
      if (editor.isActive("link")) editor.commands.extendMarkRange("link");
      setLinkOpen(true);
    });
    return () => {
      linkOpeners.delete(editor);
    };
  }, [editor]);

  const run = (fn: (c: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => fn(editor.chain().focus()).run();
  const groups: [IconName, string, string, () => void][][] = [
    [
      ["bold", "bold", `Bold (${MOD}B)`, () => run((c) => c.toggleBold())],
      ["italic", "italic", `Italic (${MOD}I)`, () => run((c) => c.toggleItalic())],
      ["strike", "strike", `Strikethrough (${MOD}Shift+X)`, () => run((c) => c.toggleStrike())],
    ],
    [["link", "link", `Link (${MOD}Shift+U)`, () => linkOpeners.get(editor)?.()]],
    [
      ["listOrdered", "orderedList", `Numbered list (${MOD}Shift+7)`, () => run((c) => c.toggleOrderedList())],
      ["list", "bulletList", `Bulleted list (${MOD}Shift+8)`, () => run((c) => c.toggleBulletList())],
    ],
    [["quote", "blockquote", `Blockquote (${MOD}Shift+9)`, () => run((c) => c.toggleBlockquote())]],
    [
      ["code", "code", `Code (${MOD}Shift+C)`, () => run((c) => c.toggleCode())],
      ["codeBlock", "codeBlock", `Code block (${MOD}Alt+C)`, () => run((c) => c.toggleCodeBlock())],
    ],
  ];

  return (
    <div className="relative flex flex-wrap items-center gap-0.5 px-2 pt-1.5 text-zinc-400">
      {groups.map((g, i) => (
        <span key={i} className="flex items-center gap-0.5">
          {i > 0 && <span className="mx-1 h-4 w-px bg-tm-line" />}
          {g.map(([icon, name, title, onClick]) => (
            <button
              key={name}
              type="button"
              title={title}
              aria-label={title}
              aria-pressed={!!active?.[name]}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onClick}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition ${active?.[name] ? "bg-tm-blue-light text-tm-blue-dark" : "hover:bg-tm-surface hover:text-zinc-700"}`}
            >
              <Icon name={icon} size={15} />
            </button>
          ))}
        </span>
      ))}
      {linkOpen && <LinkForm editor={editor} onClose={() => setLinkOpen(false)} />}
    </div>
  );
}

function LinkForm({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [range] = useState(() => ({ from: editor.state.selection.from, to: editor.state.selection.to }));
  const [text, setText] = useState(() => editor.state.doc.textBetween(range.from, range.to, " "));
  const [url, setUrl] = useState(() => (editor.getAttributes("link").href as string | undefined) ?? "");
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [onClose]);

  function save(e: React.FormEvent) {
    e.preventDefault();
    let href = url.trim();
    if (!href) return;
    if (!/^https?:\/\//i.test(href)) href = `https://${href}`;
    editor
      .chain()
      .focus()
      .insertContentAt(range, { type: "text", text: text.trim() || href, marks: [{ type: "link", attrs: { href } }] })
      .run();
    onClose();
  }

  const field = "w-full rounded-lg border border-tm-line bg-tm-surface px-2.5 py-1.5 text-sm text-zinc-800 outline-none focus:border-tm-blue/50 focus:bg-white";
  return (
    <form
      ref={ref}
      onSubmit={save}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
          editor.commands.focus();
        }
      }}
      // Opens upward: the composer sits at the bottom of the screen
      className="tm-pop tm-float absolute bottom-full left-2 z-30 mb-2 w-80 space-y-2 rounded-xl bg-white p-3"
    >
      <label className="block text-xs font-semibold text-zinc-600">
        Text
        <input className={`${field} mt-1`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Link text" />
      </label>
      <label className="block text-xs font-semibold text-zinc-600">
        Link
        <input className={`${field} mt-1`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" autoFocus />
      </label>
      <div className="flex justify-end gap-2 pt-1 text-sm">
        {editor.isActive("link") && (
          <button
            type="button"
            onClick={() => {
              editor.chain().focus().extendMarkRange("link").unsetLink().run();
              onClose();
            }}
            className="mr-auto rounded-lg px-2.5 py-1 text-red-600 transition hover:bg-red-50"
          >
            Remove
          </button>
        )}
        <button type="button" onClick={onClose} className="rounded-lg px-2.5 py-1 transition hover:bg-tm-surface">
          Cancel
        </button>
        <button type="submit" disabled={!url.trim()} className="rounded-lg bg-tm-green px-3 py-1 font-semibold text-white disabled:opacity-50">
          Save
        </button>
      </div>
    </form>
  );
}
