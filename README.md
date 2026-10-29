# Calmdown

Calm, focused reading for Markdown.

Calmdown is a Chrome extension that turns `.md` files into a comfortable reading page. It works with local files, whole folders and online links, and gives you themes, an index, focus mode, your own notes, task lists, diagrams and math. It is built with long plans, specs and technical docs in mind.

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Updating](#updating)
- [Usage](#usage)
- [Privacy and permissions](#privacy-and-permissions)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## Features

**Reading**
- Clean rendering with a sticky index (tree view) that follows your scroll. Every heading folds its section, and fold state is remembered per file.
- Eight themes (GitHub, Dracula and Monokai in light and dark, Sepia, System), three reading widths and adjustable text size.
- Text style: Google Fonts for body and headings, line / letter / paragraph spacing, and colours for headings, bold text, inline code and highlights.
- Focus mode hides the bars and fades everything but the section or paragraph you are reading.
- A footer shows headings, characters, reading time, task progress and a reading-progress bar. Its quick controls (theme, width, text size, index) change only the current tab.

**Rich Markdown**
- Code highlighting (the language is guessed when a block does not name it), line numbers and a Copy button.
- GitHub callouts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`).
- Math with `$…$` and `$$…$$` (KaTeX) and Mermaid diagrams, loaded only for documents that use them.
- Striped tables whose header row stays pinned while you scroll (wide tables scroll sideways in their own box).
- Footnotes with hover popovers.

**Notes and editing** (local files)
- Select text, click **+ Footnote** and write a note. The text is highlighted (`<mark>`) and the footnote is added and numbered for you. Remove it from its popover.
- Tick task-list checkboxes to save `- [x]` straight to the file.
- A source editor beside a live preview, with optional autosave. Saves are checked against the disk, keep line endings and BOM, and show a diff if the file changed underneath you.

**Files**
- Open a single file or a whole folder. Folder mode adds a file tree, search across all files and a quick file switcher (it also lists recent files).
- Links to `.md` files open in Calmdown automatically: web addresses (including GitHub/GitLab raw files) and local `file://` addresses. Files opened this way are read-only.
- Print or Save as PDF with a clean, light layout.

## Requirements

- **Google Chrome**, a recent version. Other Chromium browsers (Edge, Brave) should work the same way but are not tested.
- **[Node.js](https://nodejs.org/) 20.19 or newer** (or 22.12+), with npm — only if you build from source. The ready-built extension needs nothing else.
- **Git** (optional). You can download a ZIP instead.

## Installation

Calmdown is not on the Chrome Web Store yet. You load it into Chrome yourself, which takes a couple of minutes. The repository includes a ready-built copy in the `dist/` folder, so you don't need Node or a build step.

### 1. Get the code

With Git:

```bash
git clone https://github.com/SubhojitSinha/calmdown.git
```

Without Git: on the [repository page](https://github.com/SubhojitSinha/calmdown) click **Code → Download ZIP** and unzip it. Keep the unzipped folder somewhere permanent; Chrome loads the extension from it every time it starts.

### 2. Build it (optional)

Skip this step to use the ready-built `dist/` folder. To build it yourself from the source instead, open a terminal in the project folder and run:

```bash
npm install
```

```bash
npm run build
```

This recreates the `dist/` folder. Check your Node version first with `node -v`.

### 3. Load it into Chrome

1. Open `chrome://extensions` in the address bar.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist/` folder (not the project folder).
4. Optional: click the puzzle-piece icon in the toolbar and pin **Calmdown**.

### 4. Allow local file links (optional)

To open `.md` files from `file://` links or by dropping them onto a browser tab:

1. On `chrome://extensions`, click **Details** under Calmdown.
2. Turn on **Allow access to file URLs**.

Files opened from the Calmdown menu work without this setting.

## Updating

Get the latest code:

```bash
git pull
```

If you build from source, run `npm install` and `npm run build` again. Then click the reload icon on the Calmdown card in `chrome://extensions`. Your settings and recent files are kept.

If you downloaded a ZIP, replace the old folder's contents with the new ZIP's, then click reload. (If you put the new copy in a different folder instead, remove the old extension and use **Load unpacked** on the new `dist/` folder; settings start fresh in that case.)

## Usage

1. Click the Calmdown toolbar button to open the viewer.
2. Open the ☰ menu and choose **Open file** or **Open folder**, or drop a `.md` file onto the page. `test/fixtures-sample.md` is a good first file.
3. Open **Settings** from the same menu to change theme, fonts, spacing, colours and focus mode.

To open an online Markdown file, visit its address (for example a raw file on GitHub). Calmdown takes over the tab and asks for access to that site the first time.

**Keyboard shortcuts** (⌘ on macOS, Ctrl elsewhere)

| Shortcut | Action |
| --- | --- |
| Ctrl/⌘ + K | Go to file (folder files and recent files) |
| Alt/⌥ + F | Focus mode on / off |
| Ctrl/⌘ + P | Print or save as PDF |
| Ctrl/⌘ + S | Save (while editing) |

## Privacy and permissions

Reading happens in your browser. Calmdown has no server and sends your files nowhere. It uses the network only when you ask it to:
- **Online Markdown links** are fetched from their own site. Calmdown asks for access to each site the first time (Chrome's own prompt).
- **Google Fonts** are loaded only if you choose a font in Settings.

Permissions in the manifest:
- `storage`: saves your settings.
- `webNavigation`: notices when a tab opens a `.md` address and shows it in Calmdown. Chrome lists this as "Read your browsing history". No pages are read or recorded.
- Optional host access for `http`/`https`: granted per site, only when you open a file from that site.

## Troubleshooting

- **"Manifest file is missing or unreadable"**: you selected the project folder. Select the `dist/` folder inside it.
- **`npm install` or `npm run build` fails**: check `node -v`. Node 20.19 or newer is required. You can also skip building and load the ready-built `dist/` folder.
- **Local `.md` links or dropped files don't open in Calmdown**: turn on **Allow access to file URLs** (step 4 of the installation).
- **An online file doesn't load**: allow access when Chrome asks. If you declined earlier, open the link again to get the prompt back.
- **Changes don't appear after updating**: run `npm run build` again, then reload the extension on `chrome://extensions` and reload any open Calmdown tabs.
- **Edit is disabled**: editing works for local files opened from the Calmdown menu or dropped onto the Calmdown page. Online links and files opened from `file://` addresses are read-only; hover the **Read-only** tag to see why.

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Rebuilds `dist/` on every change (reload the extension to see it) |
| `npm run build` | Type-checks and builds `dist/` |
| `npm run typecheck` | TypeScript checks only |
| `npm test` | Unit tests (Vitest, jsdom) |

Built with Vite and TypeScript. Markdown is rendered by markdown-it and sanitized with DOMPurify. The editor is CodeMirror, and highlight.js, KaTeX and Mermaid handle code, math and diagrams.

**Project layout**

```
public/          manifest, background and content scripts, icons
src/viewer/      the viewer page: menu, settings, footnotes, folder mode
src/render/      the Markdown pipeline
src/editor/      the editor and source edits
src/files/       file access and recent files
src/state/       settings and view state
test/            unit tests and sample files
viewer.html      the viewer page markup
```

`dist/` is committed so people can install without building. Run `npm run build` and commit `dist/` together with any source change.

Issues and pull requests are welcome. Please run `npm run typecheck` and `npm test` before opening a pull request.

## License

[MIT](LICENSE) © 2026 Subhojit Sinha
