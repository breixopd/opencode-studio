declare module "tar-stream" {
  import { Readable, Writable } from "stream"

  interface Header {
    name: string
    size?: number
    mode?: number
    uid?: number
    gid?: number
    mtime?: Date
    type?: string
    linkname?: string | null
    uname?: string
    gname?: string
    devmajor?: number
    devminor?: number
    pax?: Record<string, string> | null
  }

  interface Pack extends Readable {
    entry(header: Header, buffer?: string | Buffer): Writable
    finalize(): void
  }

  interface Extract extends Writable {
    on(
      event: "entry",
      listener: (header: Header, stream: Readable, next: (err?: Error) => void) => void,
    ): this
    on(event: string | symbol, listener: (...args: any[]) => void): this
  }

  export function pack(opts?: Record<string, unknown>): Pack
  export function extract(opts?: Record<string, unknown>): Extract
}
