import { Bot, FileCheck2, ScanText } from 'lucide-react';

const steps = [
  {
    icon: ScanText,
    title: 'Save what you are doing',
    copy: 'Run hamma save. Hamma detects the current project and agent session without asking you for IDs or JSON files.',
  },
  {
    icon: FileCheck2,
    title: 'Switch with one command',
    copy: 'Run hamma switch claude, codex, or grok. Hamma saves, checks Git, prepares context, and opens the target agent.',
  },
  {
    icon: Bot,
    title: 'Finish without cleanup work',
    copy: 'Run hamma done. Hamma closes the correct task claim; finished work stays searchable without running again.',
  },
];

export default function HowItWorks() {
  return (
    <section id="workflow" className="section-shell workflow-section" aria-labelledby="workflow-heading">
      <div className="section-kicker">Four commands, no memory jargon</div>
      <div className="section-heading-row">
        <h2 id="workflow-heading" className="section-title">How it works</h2>
        <p>The simple CLI hides session IDs, attach IDs, update files, and lifecycle bookkeeping.</p>
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
