import { Bot, CheckCircle2, ScanText } from 'lucide-react';
import { PRODUCT_COMMANDS } from '../product';

const steps = [
  {
    icon: ScanText,
    title: 'Run one command',
    copy: 'Run Hamma inside any Git project. It detects installed agents, existing sessions, and project readiness.',
    command: PRODUCT_COMMANDS.start,
  },
  {
    icon: Bot,
    title: 'Choose your agent',
    copy: 'Pick Codex, Claude, or Grok. Hamma recommends a destination without hiding the choice.',
  },
  {
    icon: CheckCircle2,
    title: 'Continue normally',
    copy: 'After one setup confirmation, Hamma saves exact session state, prepares bounded context, and opens the agent.',
  },
];

export default function HowItWorks() {
  return (
    <section id="workflow" className="section-shell workflow-section" aria-labelledby="workflow-heading">
      <div className="section-kicker">One setup · native continuity after</div>
      <div className="section-heading-row">
        <h2 id="workflow-heading" className="section-title">How it works</h2>
        <p>Start explicitly, then let native lifecycle events maintain the thread without hiding safety boundaries.</p>
      </div>

      <div className="workflow-track">
        <div className="workflow-line" aria-hidden="true"><span /></div>
        {steps.map(({ icon: Icon, title, copy, command }, index) => (
          <article className="workflow-step" key={title}>
            <div className="step-number">0{index + 1}</div>
            <div className="step-icon"><Icon size={21} /></div>
            <h3>{title}</h3>
            <p>{copy}</p>
            {command ? <code className="step-command">{command}</code> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
