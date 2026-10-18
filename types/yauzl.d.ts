/**
 * Types minimaux pour yauzl v3.4 (le paquet ne fournit pas de .d.ts,
 * et @types/yauzl cible la v2 : on déclare exactement ce qu'on utilise).
 */
declare module "yauzl" {
  import type { Readable } from "node:stream";

  export interface Entry {
    fileName: string;
    compressedSize: number;
    uncompressedSize: number;
    compressionMethod: number;
    generalPurposeBitFlag: number;
    /** Mode unix déplacé de 16 bits (quand ZIP créé sur Unix) */
    externalFileAttributes: number;
    /** Bit 0 du general purpose flag = chiffrement traditionnel */
    isEncrypted(): false | boolean;
    /** true si stored (0) ou deflate (8) et non chiffré */
    canDecodeFileData(): boolean;
  }

  export interface ZipFile {
    close(): void;
    /** Itérateur lazy — impose lazyEntries: true (openPromise le force). */
    eachEntry(): AsyncIterableIterator<Entry>;
    openReadStreamPromise(entry: Entry): Promise<Readable>;
  }

  export interface OpenOptions {
    autoClose?: boolean;
    lazyEntries?: boolean;
    decodeStrings?: boolean;
    validateEntrySizes?: boolean;
    strictFileNames?: boolean;
  }

  export function openPromise(path: string, options?: OpenOptions): Promise<ZipFile>;
}
