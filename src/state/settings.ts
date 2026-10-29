import { kvGet, kvSet } from './store';

// 'light' and 'dark' are the GitHub palettes (labelled so in the menu); the names stay for saved settings.
const THEMES = ['system', 'light', 'dark', 'sepia', 'dracula', 'dracula-light', 'monokai', 'monokai-light'] as const;
export type ThemeName = (typeof THEMES)[number];

export interface Settings {
  theme: ThemeName;
  fontSize: number; // px
  width: number; // content max width, px
  /** Writes edits to disk a couple of seconds after typing stops. Off until trusted. */
  autosave: boolean;
  showToc: boolean;
  /** Google Fonts family for the reading text, loaded live from Google. '' is the system font. */
  font: string;
  /** Background of footnote highlights (<mark>), #rrggbb. */
  markColor: string;
  lineNumbers: boolean;
  // Text style. Spacing values are multiples of the font size; '' colours follow the theme.
  lineHeight: number;
  letterSpacing: number; // em
  paraSpacing: number; // em, gap between paragraphs, lists, code, tables; headings scale from it
  headingFont: string; // Google Fonts family like `font`; '' uses the reading font
  headingColor: string;
  boldColor: string;
  /** Inline `code` (not code blocks). */
  codeBg: string;
  codeFg: string;
  // Focus mode: what stays bright, how much the rest fades (0.4–0.95), and whether focus mode
  // comes back after a reload (focusActive is its last state, used only when focusKeep is on).
  focusUnit: 'section' | 'paragraph';
  focusFade: number;
  focusKeep: boolean;
  focusActive: boolean;
  // Read aloud: a speech voice's voiceURI ('' picks a voice on this computer) and speed (0.5–2).
  ttsVoice: string;
  ttsRate: number;
}

export const DEFAULTS: Settings = {
  theme: 'system',
  fontSize: 17,
  width: 820,
  autosave: false,
  showToc: true,
  font: '',
  markColor: '#f2c94c',
  lineNumbers: true,
  lineHeight: 1.65,
  letterSpacing: 0,
  paraSpacing: 1,
  headingFont: '',
  headingColor: '',
  boldColor: '',
  codeBg: '',
  codeFg: '',
  focusUnit: 'section',
  focusFade: 0.78,
  focusKeep: false,
  focusActive: false,
  ttsVoice: '',
  ttsRate: 1,
};
/** Family names are letters, digits and spaces; anything else is dropped rather than put in a URL. */
const FONT_NAME = /^[A-Za-z0-9 ]{1,60}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const KEY = 'settings';

const fontName = (v: unknown): string =>
  typeof v === 'string' && FONT_NAME.test(v.trim()) ? v.trim().replace(/\s+/g, ' ') : '';
const between = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function clampSettings(raw: Partial<Settings> | undefined): Settings {
  const s = { ...DEFAULTS, ...(raw ?? {}) };
  return {
    theme: (THEMES as readonly string[]).includes(s.theme) ? s.theme : DEFAULTS.theme,
    fontSize: Math.min(26, Math.max(12, Math.round(Number(s.fontSize)) || DEFAULTS.fontSize)),
    width: Math.min(1400, Math.max(560, Math.round(Number(s.width)) || DEFAULTS.width)),
    autosave: s.autosave === true,
    showToc: s.showToc !== false,
    font: fontName(s.font),
    markColor: typeof s.markColor === 'string' && HEX.test(s.markColor) ? s.markColor : DEFAULTS.markColor,
    lineNumbers: s.lineNumbers !== false,
    lineHeight: between(s.lineHeight, 1.2, 2.4, DEFAULTS.lineHeight),
    letterSpacing: between(s.letterSpacing, 0, 0.1, DEFAULTS.letterSpacing),
    paraSpacing: between(s.paraSpacing, 0.4, 2.5, DEFAULTS.paraSpacing),
    headingFont: fontName(s.headingFont),
    headingColor: typeof s.headingColor === 'string' && HEX.test(s.headingColor) ? s.headingColor : '',
    boldColor: typeof s.boldColor === 'string' && HEX.test(s.boldColor) ? s.boldColor : '',
    codeBg: typeof s.codeBg === 'string' && HEX.test(s.codeBg) ? s.codeBg : '',
    codeFg: typeof s.codeFg === 'string' && HEX.test(s.codeFg) ? s.codeFg : '',
    focusUnit: s.focusUnit === 'paragraph' ? 'paragraph' : 'section',
    focusFade: between(s.focusFade, 0.4, 0.95, DEFAULTS.focusFade),
    focusKeep: s.focusKeep === true,
    focusActive: s.focusKeep === true && s.focusActive === true,
    ttsVoice: typeof s.ttsVoice === 'string' ? s.ttsVoice.slice(0, 300) : '',
    ttsRate: between(s.ttsRate, 0.5, 2, DEFAULTS.ttsRate),
  };
}

export async function loadSettings(): Promise<Settings> {
  return clampSettings(await kvGet<Partial<Settings>>(KEY));
}

export async function saveSettings(s: Settings): Promise<void> {
  await kvSet(KEY, s);
}

export function applySettings(s: Settings, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = s.theme;
  root.style.setProperty('--font-size', `${s.fontSize}px`);
  root.style.setProperty('--content-width', `${s.width}px`);
  root.dataset.toc = s.showToc ? 'shown' : 'hidden';
  root.dataset.lineNumbers = s.lineNumbers ? 'on' : 'off';
  root.dataset.focusUnit = s.focusUnit;
  root.style.setProperty('--focus-dim', String(Math.round((1 - s.focusFade) * 100) / 100));
  root.style.setProperty('--mark-color', s.markColor);
  root.style.setProperty('--line-height', String(s.lineHeight));
  root.style.setProperty('--letter-spacing', `${s.letterSpacing}em`);
  root.style.setProperty('--para-space', `${s.paraSpacing}em`);
  const optional = (name: string, value: string) =>
    value ? root.style.setProperty(name, value) : root.style.removeProperty(name);
  optional('--heading-color', s.headingColor);
  optional('--bold-color', s.boldColor);
  optional('--inline-code-bg', s.codeBg);
  optional('--inline-code-fg', s.codeFg);
  // If Google has no such family the stylesheet fails and the fallback font stays in use.
  optional('--content-font', s.font && `'${s.font}', system-ui, sans-serif`);
  optional('--heading-font', s.headingFont && `'${s.headingFont}', var(--content-font)`);

  // One stylesheet request for both families. No weight list: Google rejects the request
  // if a family lacks one of the asked weights.
  const families = [...new Set([s.font, s.headingFont].filter(Boolean))];
  let link = document.getElementById('google-font') as HTMLLinkElement | null;
  if (families.length === 0) {
    link?.remove();
    return;
  }
  const query = families.map((f) => `family=${encodeURIComponent(f)}`).join('&');
  const href = `https://fonts.googleapis.com/css2?${query}&display=swap`;
  if (!link) {
    link = document.createElement('link');
    link.id = 'google-font';
    link.rel = 'stylesheet';
    document.head.append(link);
  }
  if (link.href !== href) link.href = href;
}
