import { decompress } from '.'
import { Hono } from '../../hono'

const compressWith = async (format: CompressionFormat, text: string): Promise<Uint8Array> => {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream(format))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const supportsBrotli = (() => {
  try {
    new DecompressionStream('brotli' as CompressionFormat)
    return true
  } catch {
    return false
  }
})()

describe('Decompress Middleware', () => {
  const app = new Hono()
  app.use(decompress())
  app.post('/', async (c) =>
    c.json({
      text: await c.req.text(),
      encoding: c.req.header('Content-Encoding') ?? null,
      length: c.req.header('Content-Length') ?? null,
    })
  )
  app.post('/json', async (c) => c.json(await c.req.json()))
  app.get('/', (c) => c.text('ok'))

  const post = (body: BodyInit | null, encoding?: string, path = '/') =>
    app.request(path, {
      method: 'POST',
      body,
      headers: encoding === undefined ? {} : { 'Content-Encoding': encoding },
    })

  it('Should decompress gzip', async () => {
    const res = await post(await compressWith('gzip', 'hello gzip'), 'gzip')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ text: 'hello gzip', encoding: null, length: null })
  })

  it('Should decompress deflate', async () => {
    const res = await post(await compressWith('deflate', 'hello deflate'), 'deflate')
    expect(res.status).toBe(200)
    expect((await res.json()).text).toBe('hello deflate')
  })

  it('Should treat the encoding name case-insensitively and accept x-gzip', async () => {
    const body = await compressWith('gzip', 'hello')
    expect((await (await post(body, 'GZip')).json()).text).toBe('hello')
    expect((await (await post(body, 'x-gzip')).json()).text).toBe('hello')
  })

  it('Should parse a decompressed JSON body', async () => {
    const res = await post(await compressWith('gzip', JSON.stringify({ a: 1 })), 'gzip', '/json')
    expect(await res.json()).toEqual({ a: 1 })
  })

  it('Should undo stacked encodings in reverse order', async () => {
    const once = await compressWith('deflate', 'stacked')
    const twice = new Uint8Array(
      await new Response(
        new Blob([once as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))
      ).arrayBuffer()
    )
    // deflate was applied first, then gzip
    const res = await post(twice, 'deflate, gzip')
    expect(res.status).toBe(200)
    expect((await res.json()).text).toBe('stacked')
  })

  it('Should pass through identity and a missing header', async () => {
    expect((await (await post('plain', 'identity')).json()).text).toBe('plain')
    expect((await (await post('plain')).json()).text).toBe('plain')
  })

  it('Should skip requests without a body', async () => {
    const res = await app.request('/', { headers: { 'Content-Encoding': 'gzip' } })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('ok')
  })

  it('Should return 415 for an unsupported encoding', async () => {
    const res = await post('data', 'compress')
    expect(res.status).toBe(415)
    const stacked = await post('data', 'gzip, zstd-unknown')
    expect(stacked.status).toBe(415)
  })

  it.runIf(supportsBrotli)('Should decompress brotli when supported', async () => {
    const { brotliCompressSync } = await import('node:zlib')
    const res = await post(brotliCompressSync('hello br'), 'br')
    expect(res.status).toBe(200)
    expect((await res.json()).text).toBe('hello br')
  })
})
