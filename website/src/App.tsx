import Hero from './components/Hero';
import Header from './components/Header';
import Problem from './components/Problem';
import HowItWorks from './components/HowItWorks';
import TerminalDemo from './components/TerminalDemo';
import Features from './components/Features';
import Safety from './components/Safety';
import Install from './components/Install';
import Limitations from './components/Limitations';
import Roadmap from './components/Roadmap';
import Updates from './components/Updates';
import Footer from './components/Footer';

export default function App() {
  return (
    <main className="min-h-screen overflow-hidden">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <div className="page-wrap">
        <Header />
        <Hero />
        <Problem />
        <HowItWorks />
        <TerminalDemo />
        <Updates />
        <Features />
        <Safety />
        <Install />
        <Limitations />
        <Roadmap />
        <Footer />
      </div>
    </main>
  );
}
