declare module 'markdown-it-footnote' {
  import type { MarkdownIt } from 'markdown-it';
  const plugin: (md: MarkdownIt) => void;
  export default plugin;
}
declare module 'markdown-it-task-lists' {
  import type { MarkdownIt } from 'markdown-it';
  const plugin: (
    md: MarkdownIt,
    options?: { enabled?: boolean; label?: boolean; labelAfter?: boolean },
  ) => void;
  export default plugin;
}

// File System Access API pieces that lib.dom does not type yet.
interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}
interface OpenFilePickerOptions {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: FilePickerAcceptType[];
}
interface FileSystemPermissionDescriptor {
  mode?: 'read' | 'readwrite';
}
interface Window {
  showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
  showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
}
interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
}
interface FileSystemHandle {
  queryPermission(d?: FileSystemPermissionDescriptor): Promise<PermissionState>;
  requestPermission(d?: FileSystemPermissionDescriptor): Promise<PermissionState>;
}
interface DataTransferItem {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}
