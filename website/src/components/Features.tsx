import { BadgeCheck, FileClock, Fingerprint, GitCompareArrows, History, Network } from 'lucide-react';

const features = [
  { icon: Network, title: 'Cross-agent continuation', desc: 'Move live work among Codex, Claude Code, and Grok with one project-aware workflow.', tone: 'violet', size: 'wide' },
  { icon: Fingerprint, title: 'Named project memory', desc: 'Keep one stable development thread across many underlying agent sessions.', tone: 'coral', size: '' },
  { icon: FileClock, title: 'Evidence-backed state', desc: 'Separate agent claims from commands, repository signals, tools, and user confirmation.', tone: 'blue', size: '' },
  { icon: GitCompareArrows, title: 'Git drift detection', desc: 'Compare the handoff snapshot with the live branch, HEAD, working tree, and relevant files.', tone: 'ink', size: '' },
  { icon: BadgeCheck, title: 'Readiness assessment', desc: 'Surface strong signals, warnings, and blockers before the receiving agent continues.', tone: 'green', size: 'wide' },
  { icon: History, title: 'Inspectable history', desc: 'Review immutable memory revisions and local handoffs without uploading a transcript.', tone: 'amber', size: '' },
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
