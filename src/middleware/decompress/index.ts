/**
 * @module
 * Decompress Middleware for Hono.
 */

import { HTTPException } from '../../http-exception'
import type { MiddlewareHandler } from '../../types'

type DecompressionFormat = 'gzip' | 'deflate' | 'brotli'

const ALIASES: Record<string, string> = {
  'x-gzip': 'gzip',
  br: 'brotli',
}

const SUPPORTED: readonly DecompressionFormat[] = ['gzip', 'deflate', 'brotli']

/**
 * Create a `DecompressionStream` for a normalized encoding name,
 * or `undefined` if the runtime does not support it.
 */
const createStream = (encoding: string): DecompressionStream | undefined => {
  if (!SUPPORTED.includes(encoding as DecompressionFormat)) {
    return undefined
  }
  try {
    return new DecompressionStream(encoding as CompressionFormat)
  } catch {
    // e.g. brotli is not supported by every runtime
    return undefined
  }
}

/**
 * Decompress Middleware for Hono.
 *
 * Decompresses request bodies that carry a `Content-Encoding` header (`gzip`, `deflate`
 * and, where the runtime's `DecompressionStream` supports it, `br`). After the
 * middleware runs, `c.req` reads the decompressed body, and the `Content-Encoding` and
 * `Content-Length` request headers are removed, because they no longer describe it.
 *
 * - Encoding names are case-insensitive; `x-gzip` is treated as `gzip`.
 * - Stacked encodings (`Content-Encoding: gzip, br`) are undone in reverse order.
 * - `identity` is passed through unchanged.
 * - An unsupported encoding results in a 415 `HTTPException`.
 *
 * Note: this middleware does not limit the decompressed size. Combine it with a limit
 * on the decompressed body if you accept untrusted clients.
 *
 * @see {@link https://hono.dev/docs/middleware/builtin/compress}
 *
 * @returns {MiddlewareHandler} The middleware handler function.
 *
 * @example
 * ```ts
 * const app = new Hono()
 *
 * app.use(decompress())
 * app.post('/', async (c) => c.json(await c.req.json()))
 * ```
 */
export const decompress = (): MiddlewareHandler => {
  return async function decompress(c, next) {
    const header = c.req.raw.headers.get('Content-Encoding')
    if (!header || !c.req.raw.body) {
      return next()
    }

    const encodings = header
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e !== '')
      .map((e) => ALIASES[e] ?? e)
      .filter((e) => e !== 'identity')

    if (encodings.length === 0) {
      return next()
    }

    // Encodings are listed in the order they were applied, so undo them in reverse.
    const streams: DecompressionStream[] = []
    for (const encoding of encodings.reverse()) {
      const stream = createStream(encoding)
      if (!stream) {
        throw new HTTPException(415, {
          message: `Unsupported Content-Encoding: ${encoding}`,
        })
      }
      streams.push(stream)
    }

    const body = streams.reduce<ReadableStream<Uint8Array>>(
      (source, stream) =>
        source.pipeThrough(stream as ReadableWritablePair<Uint8Array, Uint8Array>),
      c.req.raw.body as ReadableStream<Uint8Array>
    )

    const headers = new Headers(c.req.raw.headers)
    headers.delete('Content-Encoding')
    headers.delete('Content-Length')

    // Rebuild the request with the class that created it (see bodyLimit).
    const RequestClass: typeof Request =
      typeof c.req.raw.constructor === 'function'
        ? (c.req.raw.constructor as typeof Request)
        : Request
    c.req.raw = new RequestClass(c.req.raw, {
      headers,
      body,
      duplex: 'half',
    } as RequestInit)

    return next()
  }
}
