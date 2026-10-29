// In-memory stand-in for a FileSystemFileHandle. createWritable mimics the real swap-file
// behaviour: nothing is visible on the file until close() succeeds, abort() discards.

export class FakeHandle {
  readonly kind = 'file';
  perm: PermissionState = 'granted';
  failOn: 'write' | 'close' | null = null;
  /** Runs right after a successful close, to simulate another writer slipping in. */
  afterCommit: (() => void) | null = null;
  commits = 0;
  aborts = 0;
  private mtime = 1000;

  constructor(
    public name: string,
    private bytes: Uint8Array,
  ) {}

  static text(name: string, text: string, bom = false): FakeHandle {
    const body = new TextEncoder().encode(text);
    if (!bom) return new FakeHandle(name, body);
    const b = new Uint8Array(body.length + 3);
    b.set([0xef, 0xbb, 0xbf]);
    b.set(body, 3);
    return new FakeHandle(name, b);
  }

  /** Another program rewrites the file. */
  external(bytes: Uint8Array | string, keepMtime = false): void {
    this.bytes = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
    if (!keepMtime) this.mtime += 1;
  }
  touch(): void {
    this.mtime += 1;
  }
  raw(): Uint8Array {
    return this.bytes;
  }
  content(): string {
    return new TextDecoder().decode(this.bytes);
  }

  async getFile(): Promise<File> {
    if (this.bytes.length === -1) throw new Error('unreachable');
    return new File([this.bytes as BlobPart], this.name, { lastModified: this.mtime });
  }
  async queryPermission(): Promise<PermissionState> {
    return this.perm;
  }
  async requestPermission(): Promise<PermissionState> {
    return this.perm;
  }
  async createWritable() {
    let staged: Uint8Array | null = null;
    return {
      write: async (data: BufferSource) => {
        if (this.failOn === 'write') throw new Error('disk full');
        staged = new Uint8Array(data as ArrayBuffer).slice();
      },
      close: async () => {
        if (this.failOn === 'close') throw new Error('device removed');
        if (staged) this.bytes = staged;
        this.mtime += 1;
        this.commits++;
        this.afterCommit?.();
      },
      abort: async () => {
        this.aborts++;
        staged = null;
      },
    };
  }
}

export const asHandle = (h: FakeHandle) => h as unknown as FileSystemFileHandle;
