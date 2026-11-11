import { describe, expect, it, vi } from 'vitest'
import { loadReleases, parseReleases, pickLatest, RELEASES_API } from './releases'

const asset = (name: string, size = 5_000_000) => ({ name, size, browser_download_url: `https://example.test/${name}` })
const release = (tag: string, publishedAt: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: tag.includes('-'),
  published_at: publishedAt,
  html_url: `https://github.com/x/y/releases/tag/${tag}`,
  assets: [
    asset(`VoiceCheckBench-${tag.slice(1)}-windows-x64-setup.exe`),
    asset(`VoiceCheckBench-${tag.slice(1)}-windows-x64-setup.exe.sha256`, 100),
    asset('latest.json', 400),
  ],
  ...extra,
})

describe('parseReleases', () => {
  it('keeps releases with the Windows installer, newest first, with the checksum link', () => {
    const out = parseReleases([release('v2.0.0-alpha.1', '2026-11-01T00:00:00Z'), release('v2.0.0-alpha.2', '2026-11-10T00:00:00Z')])
    expect(out.map((r) => r.version)).toEqual(['2.0.0-alpha.2', '2.0.0-alpha.1'])
    expect(out[0]).toMatchObject({
      tag: 'v2.0.0-alpha.2',
      prerelease: true,
      installer: { name: 'VoiceCheckBench-2.0.0-alpha.2-windows-x64-setup.exe', sizeBytes: 5_000_000 },
      checksumUrl: 'https://example.test/VoiceCheckBench-2.0.0-alpha.2-windows-x64-setup.exe.sha256',
    })
  })

  it('skips drafts, the updater feed, releases without an installer and malformed entries', () => {
    const out = parseReleases([
      release('v1.0.0', '2026-10-01T00:00:00Z', { draft: true }),
      { tag_name: 'updater', published_at: '2026-11-10T00:00:00Z', html_url: 'u', assets: [asset('latest.json')] },
      release('v1.1.0', '2026-10-02T00:00:00Z', { assets: [asset('notes.txt')] }),
      null,
      'nope',
      { tag_name: 3 },
    ])
    expect(out).toEqual([])
    expect(parseReleases({ message: 'API rate limit exceeded' })).toEqual([])
  })

  it('has no checksum link when the .sha256 file is missing', () => {
    const [r] = parseReleases([release('v2.0.0', '2026-11-10T00:00:00Z', { assets: [asset('VoiceCheckBench-2.0.0-windows-x64-setup.exe')] })])
    expect(r?.checksumUrl).toBeNull()
  })
})

describe('pickLatest', () => {
  it('prefers the newest stable release over a newer pre-release', () => {
    const list = parseReleases([release('v2.1.0-beta.1', '2026-12-01T00:00:00Z'), release('v2.0.0', '2026-11-20T00:00:00Z')])
    expect(pickLatest(list)?.version).toBe('2.0.0')
  })
  it('falls back to the newest pre-release, and to null when empty', () => {
    expect(pickLatest(parseReleases([release('v2.0.0-alpha.2', '2026-11-10T00:00:00Z')]))?.version).toBe('2.0.0-alpha.2')
    expect(pickLatest([])).toBeNull()
  })
})

describe('loadReleases', () => {
  it('calls the GitHub releases API and parses the answer', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify([release('v2.0.0', '2026-11-10T00:00:00Z')]), { status: 200 }))
    const out = await loadReleases(fetchFn as unknown as typeof fetch)
    expect(fetchFn).toHaveBeenCalledWith(RELEASES_API, expect.anything())
    expect(RELEASES_API).toBe('https://api.github.com/repos/dev-vinicius-andrade/voice-check-bench/releases?per_page=20')
    expect(out?.[0]?.version).toBe('2.0.0')
  })
  it('is null on an HTTP error or a network failure', async () => {
    expect(await loadReleases((async () => new Response('{}', { status: 403 })) as unknown as typeof fetch)).toBeNull()
    expect(await loadReleases((async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch)).toBeNull()
  })
})
