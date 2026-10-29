# Calmdown

Calm, focused reading for Markdown.

Calmdown is a Chrome extension that shows `.md` files as a clean, easy to read page. It works with local files, whole folders and online links. You get themes, a table of contents, focus mode, your own notes, task lists, diagrams and math. It is made for reading long plans, specs and technical docs.

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
- A table of contents on the side that follows you as you scroll. You can fold any section by its heading, and Calmdown remembers what you folded in each file.
- Eight themes: GitHub, Dracula and Monokai (each in light and dark), Sepia and System. Three page widths and adjustable text size.
- Text style: Google Fonts for text and headings, line, letter and paragraph spacing, and colours for headings, bold text, inline code and highlights.
- Focus mode hides the top and bottom bars and fades everything except the section or paragraph you are reading.
- A bottom bar shows the number of headings, characters, reading time, task progress and how far you have read. Its quick buttons (focus mode, theme, width, text size, table of contents) change only the current tab.

**Markdown support**
- Code colouring (the language is guessed if a block does not say), line numbers and a Copy button.
- GitHub style notes and warnings (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`).
- Math with `$...$` and `$$...$$` (KaTeX) and Mermaid diagrams. These load only for files that use them.
- Striped tables with a header row that stays at the top while you scroll. Wide tables scroll sideways in their own box.
- Footnotes that show their text when you hover over them.

**Notes and editing** (local files)
- Select some text, click **+ Footnote** and write a note. The text is highlighted and the footnote is added and numbered for you. You can remove it later from the same note.
- Tick a task checkbox and it is saved as `- [x]` in the file.
- An editor next to a live preview, with optional autosave. Before saving, Calmdown checks that the file has not changed on disk. If it has, it shows you both versions so nothing is lost. Line endings are kept as they were.

**Files**
- Open a single file or a whole folder. With a folder you get a file list, search across all files, and a quick file switcher that also shows recent files.
- Links to `.md` files open in Calmdown by themselves. This works for web addresses (including raw files on GitHub and GitLab) and local `file://` addresses. Files opened this way are read-only.
- Print or save as PDF with a clean, light layout.

## Requirements

- **Google Chrome**, a recent version. Other Chromium browsers such as Edge and Brave should work the same way, but they are not tested.
- **[Node.js](https://nodejs.org/) 20.19 or newer** (or 22.12 or newer), with npm. You only need this if you want to build Calmdown yourself.
- **Git**, if you want to clone the code. You can download a ZIP instead.

## Installation

Calmdown is not on the Chrome Web Store yet, so you add it to Chrome yourself. It takes a couple of minutes. A ready to use copy is included in the `dist` folder, so you don't need Node or a build step.

### 1. Get the code

With Git:

```bash
git clone https://github.com/SubhojitSinha/calmdown.git
```

Without Git: open the [repository page](https://github.com/SubhojitSinha/calmdown), click **Code**, then **Download ZIP**, and unzip it. Keep the unzipped folder in a place where it will stay, because Chrome loads the extension from it every time it starts.

### 2. Build it (optional)

Skip this step to use the ready to use `dist` folder. If you prefer to build it yourself, open a terminal in the project folder and run:

```bash
npm install
```

```bash
npm run build
```

This creates the `dist` folder again. You can check your Node version with `node -v`.

### 3. Add it to Chrome

1. Type `chrome://extensions` in the address bar and press Enter.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `dist` folder inside the project folder.
4. Optional: click the puzzle piece icon in the toolbar and pin **Calmdown** so it is always visible.

### 4. Allow local file links (optional)

To open `.md` files from `file://` links, or by dropping them onto a normal browser tab:

1. On `chrome://extensions`, click **Details** under Calmdown.
2. Turn on **Allow access to file URLs**.

You don't need this for files you open from the Calmdown menu.

## Updating

Get the latest code:

```bash
git pull
```

If you build it yourself, run `npm install` and `npm run build` again. Then click the reload button on the Calmdown card in `chrome://extensions`. Your settings and recent files are kept.

If you downloaded a ZIP, replace the files in your old folder with the ones from the new ZIP, then click reload. If you put the new copy in a different folder instead, remove the old extension and load the new `dist` folder. Your settings will start fresh in that case.

## Usage

1. Click the Calmdown button in the toolbar to open it.
2. Open the menu (top left) and choose **Open file** or **Open folder**, or drop a `.md` file onto the page. `test/fixtures-sample.md` is a good file to start with.
3. Open **Settings** from the same menu to change the theme, fonts, spacing, colours and focus mode.

To read an online Markdown file, just open its address, for example a raw file on GitHub. Calmdown opens it and asks for access to that site the first time.

**Keyboard shortcuts** (use Cmd instead of Ctrl, and Option instead of Alt, on a Mac)

| Shortcut | Action |
| --- | --- |
| Ctrl + K | Go to a file (folder files and recent files) |
| Alt + F | Turn focus mode on or off |
| Ctrl + P | Print or save as PDF |
| Ctrl + S | Save (while editing) |

## Privacy and permissions

Everything happens in your browser. Calmdown has no server and does not send your files anywhere. It only goes online when you ask it to:
- **Online Markdown links** are downloaded from their own website. Calmdown asks for access to each website the first time, using Chrome's normal prompt.
- **Google Fonts** are loaded only if you pick a font in Settings.

Permissions Calmdown asks for:
- `storage`: to save your settings.
- `webNavigation`: to notice when a tab opens a `.md` address and show it in Calmdown. Chrome describes this as "Read your browsing history". Calmdown does not read or keep any pages.
- Access to websites (optional): asked for one website at a time, only when you open a file from it.

## Troubleshooting

- **Chrome says the manifest file is missing**: you chose the project folder. Choose the `dist` folder inside it.
- **`npm install` or `npm run build` fails**: check `node -v`. You need Node 20.19 or newer. You can also skip building and use the ready to use `dist` folder.
- **Local `.md` links or dropped files don't open in Calmdown**: turn on **Allow access to file URLs** (step 4 above).
- **An online file doesn't load**: allow access when Chrome asks. If you said no before, open the link again to see the prompt again.
- **Changes don't show up after updating**: run `npm run build` again, reload the extension on `chrome://extensions`, then reload any open Calmdown tabs.
- **Edit is greyed out**: you can edit local files opened from the Calmdown menu or dropped onto the Calmdown page. Online links and files opened from `file://` addresses are read-only. Hover over the **Read-only** label to see why.

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Rebuilds `dist` every time you save a change (reload the extension to see it) |
| `npm run build` | Checks the types and builds `dist` |
| `npm run typecheck` | Checks the types only |
| `npm test` | Runs the tests (Vitest) |

Built with Vite and TypeScript. Markdown is turned into HTML by markdown-it and cleaned by DOMPurify. The editor is CodeMirror. highlight.js, KaTeX and Mermaid handle code, math and diagrams.

**Project layout**

```
public/          manifest, background and content scripts, icons
src/viewer/      the main page: menu, settings, footnotes, folder mode
src/render/      turns Markdown into HTML
src/editor/      the editor and changes to the file
src/files/       opening files and recent files
src/state/       settings and saved view state
test/            tests and sample files
viewer.html      the main page layout
```

The `dist` folder is kept in the repository so people can install without building. After any code change, run `npm run build` and commit `dist` along with it.

Issues and pull requests are welcome. Please run `npm run typecheck` and `npm test` before you open a pull request.

## License

[MIT](LICENSE). Copyright 2026 Subhojit Sinha.
