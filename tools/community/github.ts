// Shared by tools/community/aggregate.ts and review.ts: GitHub REST access, issue mapping, aliases file.
import { readFile } from 'node:fs/promises'
import { COMMUNITY_LABEL, COMMUNITY_REPO, type CommunityIssue, type MicAliases } from '../../src/community/types'

/** Issue as the REST API returns it (only the fields used here). */
export interface ApiIssue {
  number?: number
  body?: string | null
  user?: { login?: string } | null
  labels?: (string | { name?: string })[]
  state?: string
  reactions?: { '+1'?: number }
  pull_request?: unknown
  closed_by?: { login?: string } | null
}

export const BOT_LOGIN = 'github-actions[bot]'
export const repo = process.env.COMMUNITY_REPO || COMMUNITY_REPO
const API = 'https://api.github.com'
const PER_PAGE = 100
const MAX_PAGES = 50
const ALIASES = new URL('./aliases.json', import.meta.url)

const headers = (): Record<string, string> => ({
  Accept: 'application/vnd.github+json',
  'User-Agent': 'voice-check-bench',
  'X-GitHub-Api-Version': '2022-11-28',
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
})

/** REST call on this repo (`path` starts with "/"); throws on a non-2xx status except `allow` ones (→ null). */
export async function api<T>(method: string, path: string, body?: unknown, allow: number[] = []): Promise<T | null> {
  const url = `${API}/repos/${repo}${path}`
  const res = await fetch(url, {
    method,
    headers: { ...headers(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (allow.includes(res.status)) return null
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText} for ${method} ${url}: ${await res.text()}`)
  return res.status === 204 ? null : ((await res.json()) as T)
}

/** All pages of a list endpoint (`path` may already have a query). */
export async function apiList<T>(path: string): Promise<T[]> {
  const all: T[] = []
  const sep = path.includes('?') ? '&' : '?'
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = (await api<T[]>('GET', `${path}${sep}per_page=${PER_PAGE}&page=${page}`)) ?? []
    all.push(...batch)
    if (batch.length < PER_PAGE) break
  }
  return all
}

/** Every mic-result issue, open and closed, without pull requests. */
export const fetchIssues = async (): Promise<ApiIssue[]> =>
  (await apiList<ApiIssue>(`/issues?labels=${encodeURIComponent(COMMUNITY_LABEL)}&state=all`)).filter((i) => !i.pull_request)

/** API issue (or a --from-file entry) → CommunityIssue; missing fields: author '', labels [], state open, votes 0, number index+1. */
export function toCommunityIssue(i: ApiIssue, index: number): CommunityIssue {
  return {
    number: typeof i.number === 'number' ? i.number : index + 1,
    author: i.user?.login ?? '',
    body: i.body ?? '',
    labels: (i.labels ?? []).map((l) => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean),
    state: i.state === 'closed' ? 'closed' : 'open',
    votes: typeof i.reactions?.['+1'] === 'number' ? i.reactions['+1'] : 0,
  }
}

export async function readIssuesFile(path: string): Promise<ApiIssue[]> {
  const data: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!Array.isArray(data)) throw new Error(`${path}: expected a JSON array of issue objects ({ body, ... })`)
  return (data as ApiIssue[]).filter((i) => !i.pull_request)
}

const EMPTY_ALIASES: MicAliases = { aliases: {}, distinct: [] }

/** tools/community/aliases.json; a missing or broken file gives empty aliases (logged). */
export async function loadAliases(): Promise<MicAliases> {
  try {
    const data = JSON.parse(await readFile(ALIASES, 'utf8')) as Partial<MicAliases>
    const aliases = Object.fromEntries(
      Object.entries(data.aliases ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== ''),
    )
    const distinct = (Array.isArray(data.distinct) ? data.distinct : []).filter(
      (p): p is [string, string] => Array.isArray(p) && p.length === 2 && p.every((k) => typeof k === 'string'),
    )
    return { aliases, distinct }
  } catch (e) {
    console.warn(`aliases.json not used (${e instanceof Error ? e.message : String(e)}); continuing without aliases`)
    return EMPTY_ALIASES
  }
}
