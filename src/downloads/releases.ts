// Desktop app releases for the Download page (SPEC "Distribution"): read from the public GitHub Releases API.
// Framework-free. Only releases that carry the Windows installer count; drafts and the `updater` feed release are skipped.
import { SITE } from '../site'

export const RELEASES_API = `${SITE.repo.replace('https://github.com/', 'https://api.github.com/repos/')}/releases?per_page=20`
export const RELEASES_PAGE = `${SITE.repo}/releases`
/** Installer asset name written by release.yml: VoiceCheckBench-<version>-windows-x64-setup.exe */
const INSTALLER = /-windows-x64-setup\.exe$/

export interface DesktopAsset {
  name: string
  url: string
  sizeBytes: number
}

export interface DesktopRelease {
  /** Version without the leading "v", e.g. 2.0.0-alpha.2. */
  version: string
  tag: string
  prerelease: boolean
  /** ISO date the release was published. */
  publishedAt: string
  /** The release page on GitHub. */
  page: string
  installer: DesktopAsset
  /** The .sha256 file next to the installer, when present. */
  checksumUrl: string | null
}

interface GhAsset {
  name?: unknown
  browser_download_url?: unknown
  size?: unknown
}
interface GhRelease {
  tag_name?: unknown
  draft?: unknown
  prerelease?: unknown
  published_at?: unknown
  html_url?: unknown
  assets?: unknown
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

function toRelease(r: GhRelease): DesktopRelease | null {
  const tag = str(r.tag_name)
  const publishedAt = str(r.published_at)
  const page = str(r.html_url)
  if (!tag || !publishedAt || !page || r.draft === true || tag === 'updater' || !Array.isArray(r.assets)) return null
  const assets = r.assets as GhAsset[]
  const exe = assets.find((a) => typeof a.name === 'string' && INSTALLER.test(a.name))
  const url = str(exe?.browser_download_url)
  if (!exe || !url) return null
  const name = exe.name as string
  const sum = assets.find((a) => a.name === `${name}.sha256`)
  return {
    version: tag.replace(/^v/, ''),
    tag,
    prerelease: r.prerelease === true,
    publishedAt,
    page,
    installer: { name, url, sizeBytes: typeof exe.size === 'number' ? exe.size : 0 },
    checksumUrl: str(sum?.browser_download_url),
  }
}

/** Desktop releases from a GitHub /releases response, newest first. Anything malformed is skipped, never thrown. */
export function parseReleases(json: unknown): DesktopRelease[] {
  if (!Array.isArray(json)) return []
  return json
    .map((r) => (typeof r === 'object' && r !== null ? toRelease(r as GhRelease) : null))
    .filter((r): r is DesktopRelease => r !== null)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
}

/** The release to offer first: the newest stable one, or the newest pre-release while there is no stable release. */
export function pickLatest(releases: readonly DesktopRelease[]): DesktopRelease | null {
  return releases.find((r) => !r.prerelease) ?? releases[0] ?? null
}

/** Fetch and parse; null when the API cannot be reached or answers with an error (rate limit, offline). */
export async function loadReleases(fetchFn: typeof fetch = fetch): Promise<DesktopRelease[] | null> {
  try {
    const res = await fetchFn(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return null
    return parseReleases(await res.json())
  } catch {
    return null
  }
}
