import { useRouter } from './router';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import HomePage from './pages/HomePage';
import FeaturesPage from './pages/FeaturesPage';
import HowItWorksPage from './pages/HowItWorksPage';
import DashboardPage from './pages/DashboardPage';
import ArchitecturePage from './pages/ArchitecturePage';
import PricingPage from './pages/PricingPage';
import DocsPage from './pages/DocsPage';
import DevelopersPage from './pages/DevelopersPage';
import ContactPage from './pages/ContactPage';
import AuthPage from './pages/AuthPage';

function App() {
  const { route } = useRouter();

  const isAuthPage = route === 'login' || route === 'signup';

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100 overflow-x-hidden">
      {!isAuthPage && <Navbar />}
      <main>
        {route === 'home' && <HomePage />}
        {route === 'features' && <FeaturesPage />}
        {route === 'how-it-works' && <HowItWorksPage />}
        {route === 'dashboard' && <DashboardPage />}
        {route === 'architecture' && <ArchitecturePage />}
        {route === 'pricing' && <PricingPage />}
        {route === 'docs' && <DocsPage />}
        {route === 'developers' && <DevelopersPage />}
        {route === 'contact' && <ContactPage />}
        {route === 'login' && <AuthPage mode="login" />}
        {route === 'signup' && <AuthPage mode="signup" />}
      </main>
      {!isAuthPage && <Footer />}
    </div>
  );
}

export default App;
