import { ResultsScreen } from './components/results/ResultsScreen'
import { SetupScreen } from './components/setup/SetupScreen'
import { StepScreen } from './components/step/StepScreen'
import { StatusSnackbar } from './components/layout/StatusSnackbar'
import { TopBar } from './components/layout/TopBar'
import { useBootstrap } from './hooks/useBootstrap'
import { useRecordingShortcuts } from './hooks/useRecordingShortcuts'
import { useBench } from './store/benchStore'

export default function App() {
  useBootstrap()
  useRecordingShortcuts()
  const screen = useBench((s) => s.screen)
  return (
    <>
      <TopBar />
      <main className="px-4 py-8 sm:py-10">
        {screen === 'setup' && <SetupScreen />}
        {screen === 'step' && <StepScreen />}
        {screen === 'results' && <ResultsScreen />}
      </main>
      <StatusSnackbar />
    </>
  )
}
