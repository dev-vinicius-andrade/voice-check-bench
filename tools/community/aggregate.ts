// Builds public/community/mics.json from the "mic-result" issues (SPEC "Community results via GitHub issues").
// Run: npm run community:aggregate            (GitHub REST API; GITHUB_TOKEN optional, raises the rate limit)
//      npm run community:aggregate -- --from-file issues.json   (offline: a JSON array of issue objects, at least { body })
// Env: COMMUNITY_REPO overrides the repo from src/community/types.ts (e.g. a fork).
// Every issue goes through the same review as tools/community/review.ts, so only accepted reports count.
import { readFile, writeFile } from 'node:fs/promises'
import { aggregate } from '../../src/community/aggregate'
import { reviewedReports, reviewIssues } from '../../src/community/review'
import { COMMUNITY_LABEL, type CommunityIndex } from '../../src/community/types'
import { fetchIssues, loadAliases, readIssuesFile, repo, toCommunityIssue } from './github'

const OUT = new URL('../../public/community/mics.json', import.meta.url)
const source = `https://github.com/${repo}/issues?q=label%3A${encodeURIComponent(COMMUNITY_LABEL)}`

/** The stored index without its timestamp, to skip rewriting when nothing but `generated` would change. */
const comparable = (i: Pick<CommunityIndex, 'version' | 'source' | 'reports' | 'mics'>): string =>
  JSON.stringify({ version: i.version, source: i.source, reports: i.reports, mics: i.mics })

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const fileIdx = args.indexOf('--from-file')
  const fromFile = fileIdx >= 0 ? args[fileIdx + 1] : undefined
  if (fileIdx >= 0 && !fromFile) throw new Error('--from-file needs a path')

  const issues = (fromFile ? await readIssuesFile(fromFile) : await fetchIssues()).map(toCommunityIssue)
  const aliases = await loadAliases()
  const verdicts = reviewIssues(issues, aliases)
  const index = aggregate(reviewedReports(issues, verdicts), new Date(), source)

  let previous: CommunityIndex | null = null
  try {
    previous = JSON.parse(await readFile(OUT, 'utf8')) as CommunityIndex
  } catch {
    previous = null
  }
  const unchanged = previous !== null && comparable(previous) === comparable(index)
  if (!unchanged) await writeFile(OUT, `${JSON.stringify(index, null, 2)}\n`, 'utf8')

  const count = (kind: string) => [...verdicts.values()].filter((v) => v.kind === kind).length
  const replaced = [...verdicts.values()].filter((v) => v.kind === 'accepted' && v.replaces !== null).length
  console.log(`source: ${fromFile ?? `https://api.github.com/repos/${repo}/issues (label ${COMMUNITY_LABEL})`}`)
  console.log(
    `issues: ${issues.length} (accepted ${count('accepted')}, replaced ${replaced}, invalid ${count('invalid')}, duplicate ${count('duplicate')}, rejected ${count('rejected')}), reports used: ${index.reports}, mics: ${index.mics.length}`,
  )
  for (const m of index.mics) {
    console.log(`  ${JSON.stringify(m.model)}: ${m.reports} report(s), raw SNR median ${m.rawSnr.median} dB, ${m.solutions?.length ?? 0} solution(s)`)
  }
  console.log(unchanged ? 'public/community/mics.json unchanged' : 'wrote public/community/mics.json')
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
