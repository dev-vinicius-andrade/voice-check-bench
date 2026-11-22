// Desktop integration of the hardware-agnostic classifier: renders ProblemReport as plain-language
// explanations alongside the autotune result's technical changes. Framework-aware (React + MUI).
// Computes analysis from the raw take so users see *why* something changed in everyday language.
import { useMemo } from 'react'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import { useTranslation } from 'react-i18next'
import { analyze } from '../../../audio/analyze'
import { classify, type ProblemReport } from '../../../plain/classify'
import { useMicProfile, useGoal } from '../../../store/hooks'
import { isAnalysisError, type AnalysisResult } from '../../../types'
import { MsgText } from '../../common/MsgText'

const TUNE_SAMPLE_RATE = 48000

const severityColor = (s: 'bad' | 'warn'): 'error' | 'warning' => (s === 'bad' ? 'error' : 'warning')

interface ProblemExplanationsProps {
 /** The raw take before any processing; analysis is computed from this. */
 take: Float32Array
}

/**
 * Plain-language explanations of what the classifier found in the raw take, shown on the result step
 * alongside the technical ChangesList. Helps non-audio users understand *why* changes were made.
 */
export function ProblemExplanations({ take }: ProblemExplanationsProps) {
 const { t } = useTranslation()
 const mic = useMicProfile()
 const goal = useGoal()

 const report: ProblemReport | null = useMemo(() => {
 const result: AnalysisResult = analyze(take, TUNE_SAMPLE_RATE)
 if (isAnalysisError(result)) return null
 return classify(result, mic, goal)
 }, [take, mic, goal])

 if (!report || report.problems.length === 0) return null

 return (
 <Paper component="section" aria-labelledby="problem-explanations-title" className="grid gap-3 p-4" elevation={0} variant="outlined">
 <Typography id="problem-explanations-title" variant="subtitle2" color="text.secondary">
 {t('desktop.autotune.ui.problems.title', { count: report.problems.length })}
 </Typography>
 <ul className="m-0 grid list-none gap-2 p-0">
 {report.problems.map((p) => (
 <li key={p.kind} className="grid gap-1">
 <div className="flex items-start gap-2">
 <Chip size="small" color={severityColor(p.severity)} label={t(`results.problems.severity.${p.severity}`)} />
 <Typography variant="body2" sx={{ fontWeight: 500 }}>
 <MsgText msg={p.summary} />
 </Typography>
 </div>
 {p.steps.length > 0 && (
 <ul className="m-0 ml-6 list-disc gap-1 p-0">
 {p.steps.slice(0, 2).map((step, i) => (
 <li key={i}>
 <Typography variant="caption" color="text.secondary">
 <MsgText msg={step.text} />
 </Typography>
 </li>
 ))}
 </ul>
 )}
 </li>
 ))}
 </ul>
 </Paper>
 )
}