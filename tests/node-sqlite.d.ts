// The slice of node:sqlite the history tests use. Not @types/node: its global timers clash with the DOM's in src/.
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    prepare(sql: string): { run(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] };
  }
}
