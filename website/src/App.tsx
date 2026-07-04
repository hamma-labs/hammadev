import Hero from './components/Hero';
import Problem from './components/Problem';
import HowItWorks from './components/HowItWorks';
import TerminalDemo from './components/TerminalDemo';
import Features from './components/Features';
import Safety from './components/Safety';
import Install from './components/Install';
import Limitations from './components/Limitations';
import Roadmap from './components/Roadmap';
import Footer from './components/Footer';

export default function App() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center">
      {/* Outer wrapper to contain max content width */}
      <div className="w-full max-w-5xl px-6 md:px-12 flex flex-col gap-24 md:gap-36 py-12 md:py-24">
        <Hero />
        <Problem />
        <HowItWorks />
        <TerminalDemo />
        <Features />
        <Safety />
        <Install />
        <Limitations />
        <Roadmap />
        <Footer />
      </div>
    </div>
  );
}
