import { GuideScreen } from './components/guide/GuideScreen'
import { DesktopScreen } from './components/desktop/DesktopScreen'
import { UpdateNotice } from './components/desktop/UpdateNotice'
import { CommunityPage } from './components/pages/CommunityPage'
import { HomePage } from './components/pages/HomePage'
import { HowItWorksPage } from './components/pages/HowItWorksPage'
import { PrivacyPage } from './components/pages/PrivacyPage'
import { LiveScreen } from './components/live/LiveScreen'
import { ProfilesPage } from './components/profiles/ProfilesPage'
import { ResultsScreen } from './components/results/ResultsScreen'
import { SetupScreen } from './components/setup/SetupScreen'
import { StepScreen } from './components/step/StepScreen'
import { Footer } from './components/layout/Footer'
import { StatusSnackbar } from './components/layout/StatusSnackbar'
import { TopBar } from './components/layout/TopBar'
import { useBootstrap } from './hooks/useBootstrap'
import { useHashRoute } from './hooks/useHashRoute'
import { useRecordingShortcuts } from './hooks/useRecordingShortcuts'
import { isDesktop } from './desktop/bridge'
import { useBench } from './store/benchStore'

export default function App() {
  useBootstrap()
  useHashRoute()
  useRecordingShortcuts()
  const screen = useBench((s) => s.screen)
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main className="flex-1 px-4 py-8 sm:py-10">
        {screen === 'home' && <HomePage />}
        {screen === 'how' && <HowItWorksPage />}
        {screen === 'community' && <CommunityPage />}
        {screen === 'privacy' && <PrivacyPage />}
        {screen === 'setup' && <SetupScreen />}
        {screen === 'step' && <StepScreen />}
        {screen === 'results' && <ResultsScreen />}
        {screen === 'guide' && <GuideScreen />}
        {screen === 'profiles' && <ProfilesPage />}
        {screen === 'live' && <LiveScreen />}
        {screen === 'desktop' && isDesktop() && <DesktopScreen />}
      </main>
      <Footer />
      <StatusSnackbar />
      {isDesktop() && <UpdateNotice />}
    </div>
  )
}
