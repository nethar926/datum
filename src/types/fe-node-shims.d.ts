/** FE DOM tsconfig shims: acoustics wasm/kernel references Buffer; seek stress uses worker_threads. */
declare const Buffer: {
  from(data: string, encoding?: string): Uint8Array
}

declare module 'node:worker_threads' {
  export class Worker {
    constructor(script: string | URL, options?: { eval?: boolean })
    postMessage(value: unknown): void
    terminate(): Promise<number>
  }
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string
}
declare module 'node:path' {
  export function dirname(p: string): string
  export function join(...parts: string[]): string
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string
}
