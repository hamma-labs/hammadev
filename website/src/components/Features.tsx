import { FileClock, Fingerprint, History, Network, ShieldCheck, TerminalSquare } from 'lucide-react';

const features = [
  { icon: Network, title: 'Two-way handoffs', desc: 'Move live work from Codex to Claude Code—or back again.', tone: 'violet', size: 'wide' },
  { icon: Fingerprint, title: 'Project-aware', desc: 'Matches resumable sessions to the repository you are actually in.', tone: 'coral', size: '' },
  { icon: FileClock, title: 'Focused memory', desc: 'Captures decisions and next actions without forcing the next agent through a raw transcript.', tone: 'blue', size: '' },
  { icon: TerminalSquare, title: 'CLI-native', desc: 'Fits the terminal workflow you already use. No web account or hosted workspace.', tone: 'ink', size: '' },
  { icon: ShieldCheck, title: 'Local by default', desc: 'Reads local sessions, writes local artifacts, and makes no network calls.', tone: 'green', size: 'wide' },
  { icon: History, title: 'Inspectable history', desc: 'Review previous handoffs with status, log, and show.', tone: 'amber', size: '' },
];

export default function Features() {
  return (
    <section className="section-shell" aria-labelledby="features-heading">
      <div className="section-kicker">Built for real repositories</div>
      <div className="section-heading-row">
        <h2 id="features-heading" className="section-title">Small tool. Serious continuity.</h2>
        <p>HammaDev stays out of the way until you need to switch agents, recover context, or audit what happened.</p>
      </div>
      <div className="feature-grid">
        {features.map(({ icon: Icon, title, desc, tone, size }) => (
          <article key={title} className={`feature-tile ${size}`}>
            <div className={`feature-icon ${tone}`}><Icon size={20} /></div>
            <h3>{title}</h3>
            <p>{desc}</p>
            <span className="tile-corner" aria-hidden="true" />
          </article>
        ))}
      </div>
    </section>
  );
}
