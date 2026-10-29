import { describe, expect, it } from 'vitest';
import { encodeForDisk, loadFile, saveFile, hasWritePermission } from '../src/files/file-layer';
import { FakeHandle, asHandle } from './fake-handle';

const load = (h: FakeHandle) => loadFile(asHandle(h));

describe('loadFile', () => {
  it('reads text, BOM, dominant EOL and a content hash', async () => {
    const h = FakeHandle.text('a.md', 'one\r\ntwo\r\n', true);
    const f = await load(h);
    expect(f.text).toBe('one\r\ntwo\r\n');
    expect(f.bom).toBe(true);
    expect(f.eol).toBe('\r\n');
    expect(f.mixedEol).toBe(false);
    expect(f.editable).toBe(true);
    expect(f.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('flags mixed line endings', async () => {
    expect((await load(FakeHandle.text('m.md', 'a\r\nb\nc\r\n'))).mixedEol).toBe(true);
    expect((await load(FakeHandle.text('m.md', 'a\rb\r'))).mixedEol).toBe(true);
    expect((await load(FakeHandle.text('m.md', 'a\nb\n'))).mixedEol).toBe(false);
  });

  it('marks invalid UTF-8 as not editable instead of silently mangling it', async () => {
    const f = await load(new FakeHandle('bin.md', new Uint8Array([0x66, 0xff, 0xfe, 0x6f])));
    expect(f.editable).toBe(false);
  });

  it('hash differs for different content and matches for identical content', async () => {
    const a = await load(FakeHandle.text('a.md', 'same'));
    const b = await load(FakeHandle.text('b.md', 'same'));
    const c = await load(FakeHandle.text('c.md', 'diff'));
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
  });
});

describe('encodeForDisk', () => {
  it('round-trips an unedited file byte for byte, whatever its endings, BOM or last line', async () => {
    const cases = ['', 'x', 'x\n', 'a\nb\n\n', 'a\r\nb\r\n', 'a\r\nb', '\n', '# t\n\n- a\n- b'];
    for (const bom of [false, true]) {
      for (const text of cases) {
        const h = FakeHandle.text('r.md', text, bom);
        const f = await load(h);
        // The editor holds LF text; the file layer restores the original endings.
        const editorText = f.text.replace(/\r\n/g, '\n');
        expect(Array.from(encodeForDisk(editorText, f))).toEqual(Array.from(h.raw()));
      }
    }
  });

  it('converts LF editor text to CRLF when the file was CRLF', () => {
    const out = new TextDecoder().decode(encodeForDisk('a\nb\n', { eol: '\r\n', bom: false }));
    expect(out).toBe('a\r\nb\r\n');
  });

  it('does not double-convert text that already has CRLF', () => {
    const out = new TextDecoder().decode(encodeForDisk('a\r\nb', { eol: '\r\n', bom: false }));
    expect(out).toBe('a\r\nb');
  });
});

describe('saveFile', () => {
  it('writes an edit and returns the verified new baseline', async () => {
    const h = FakeHandle.text('n.md', '# Title\n');
    const base = await load(h);
    const res = await saveFile(asHandle(h), base, '# Title\n\nmore\n');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.wrote).toBe(true);
    expect(h.content()).toBe('# Title\n\nmore\n');
    expect(res.loaded.hash).not.toBe(base.hash);
    // The returned baseline lets the next save succeed without a false conflict.
    const again = await saveFile(asHandle(h), res.loaded, '# Title\n\nmore\n\nand more\n');
    expect(again.ok).toBe(true);
  });

  it('does not write when nothing changed', async () => {
    const h = FakeHandle.text('n.md', 'same\n');
    const base = await load(h);
    const res = await saveFile(asHandle(h), base, 'same\n');
    expect(res).toMatchObject({ ok: true, wrote: false });
    expect(h.commits).toBe(0);
  });

  it('keeps CRLF and BOM when saving an edit', async () => {
    const h = FakeHandle.text('w.md', 'a\r\nb\r\n', true);
    const base = await load(h);
    const res = await saveFile(asHandle(h), base, 'a\nb\nc\n');
    expect(res.ok).toBe(true);
    const f = await load(h);
    expect(f.bom).toBe(true);
    expect(f.text).toBe('a\r\nb\r\nc\r\n');
  });

  it('refuses to overwrite a file that changed on disk, and writes nothing', async () => {
    const h = FakeHandle.text('c.md', 'original\n');
    const base = await load(h);
    h.external('edited elsewhere\n');
    const res = await saveFile(asHandle(h), base, 'my edit\n');
    expect(res.ok).toBe(false);
    if (res.ok || res.reason !== 'conflict') throw new Error('expected conflict');
    expect(res.disk.text).toBe('edited elsewhere\n');
    expect(h.content()).toBe('edited elsewhere\n');
    expect(h.commits).toBe(0);
  });

  it('detects a conflict even when mtime and size are unchanged (hash, not timestamps)', async () => {
    const h = FakeHandle.text('c.md', 'aaaa\n');
    const base = await load(h);
    h.external('bbbb\n', true); // same size, same mtime
    expect(base.stamp).toBe((await load(h)).stamp);
    const res = await saveFile(asHandle(h), base, 'mine\n');
    expect(res).toMatchObject({ ok: false, reason: 'conflict' });
    expect(h.content()).toBe('bbbb\n');
  });

  it('does not report a conflict when the file was only touched', async () => {
    const h = FakeHandle.text('t.md', 'x\n');
    const base = await load(h);
    h.touch();
    expect((await saveFile(asHandle(h), base, 'y\n')).ok).toBe(true);
    expect(h.content()).toBe('y\n');
  });

  it('leaves the original untouched and aborts when the write fails', async () => {
    const h = FakeHandle.text('f.md', 'keep me\n');
    const base = await load(h);
    h.failOn = 'write';
    const res = await saveFile(asHandle(h), base, 'new\n');
    expect(res).toMatchObject({ ok: false, reason: 'error' });
    expect(h.content()).toBe('keep me\n');
    expect(h.aborts).toBe(1);
  });

  it('leaves the original untouched when the final commit fails', async () => {
    const h = FakeHandle.text('f.md', 'keep me\n');
    const base = await load(h);
    h.failOn = 'close';
    const res = await saveFile(asHandle(h), base, 'new\n');
    expect(res).toMatchObject({ ok: false, reason: 'error' });
    expect(h.content()).toBe('keep me\n');
  });

  it('never prompts and writes nothing when write permission is missing', async () => {
    const h = FakeHandle.text('p.md', 'x\n');
    const base = await load(h);
    h.perm = 'prompt';
    expect(await hasWritePermission(asHandle(h))).toBe(false);
    const res = await saveFile(asHandle(h), base, 'y\n');
    expect(res).toEqual({ ok: false, reason: 'permission' });
    expect(h.commits).toBe(0);
  });

  it('reports a writer that slipped in right after our commit (verify step)', async () => {
    const h = FakeHandle.text('v.md', 'x\n');
    const base = await load(h);
    h.afterCommit = () => h.external('someone else\n');
    const res = await saveFile(asHandle(h), base, 'mine\n');
    expect(res).toMatchObject({ ok: false, reason: 'verify' });
  });

  it('refuses to write a file that is not valid UTF-8', async () => {
    const h = new FakeHandle('bin.md', new Uint8Array([0x66, 0xff, 0xfe]));
    const base = await load(h);
    const res = await saveFile(asHandle(h), base, 'text\n');
    expect(res).toMatchObject({ ok: false, reason: 'error' });
    expect(h.commits).toBe(0);
  });

  it('reports a read error if the file vanished before saving', async () => {
    const h = FakeHandle.text('gone.md', 'x\n');
    const base = await load(h);
    h.getFile = async () => {
      throw new DOMException('not found', 'NotFoundError');
    };
    const res = await saveFile(asHandle(h), base, 'y\n');
    expect(res).toMatchObject({ ok: false, reason: 'error' });
    expect(h.commits).toBe(0);
  });
});
