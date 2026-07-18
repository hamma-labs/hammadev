import { Bot, FileCheck2, ScanText } from 'lucide-react';

const steps = [
  {
    icon: ScanText,
    title: 'Read local agent sessions',
    copy: 'Hamma discovers the strongest project-related Codex, Claude Code, or Grok session without modifying its source files.',
  },
  {
    icon: FileCheck2,
    title: 'Create clean task memory',
    copy: 'It reconstructs the goal, completed work, evidence, Git state, next action, and known risks.',
  },
  {
    icon: Bot,
    title: 'Continue in another agent',
    copy: 'The target agent gets a compact handoff, drift warning, readiness assessment, and exact resume command.',
  },
];

export default function HowItWorks() {
  return (
    <section id="workflow" className="section-shell workflow-section" aria-labelledby="workflow-heading">
      <div className="section-kicker">From session to continuation</div>
      <div className="section-heading-row">
        <h2 id="workflow-heading" className="section-title">How it works</h2>
        <p>A local pipeline that turns a long agent session into useful working memory.</p>
      </div>

      <div className="workflow-track">
        <div className="workflow-line" aria-hidden="true"><span /></div>
        {steps.map(({ icon: Icon, title, copy }, index) => (
          <article className="workflow-step" key={title}>
            <div className="step-number">0{index + 1}</div>
            <div className="step-icon"><Icon size={21} /></div>
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
