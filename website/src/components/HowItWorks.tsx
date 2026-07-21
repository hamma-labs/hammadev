import { Bot, FileCheck2, ScanText, Webhook } from 'lucide-react';
import { PRODUCT_COMMANDS } from '../product';

const steps = [
  {
    icon: ScanText,
    title: 'Enable memory explicitly',
    copy: 'Run hamma save once. Hamma detects the current project and exact agent session without asking for IDs or JSON files.',
    command: PRODUCT_COMMANDS.save,
  },
  {
    icon: Webhook,
    title: 'Install trusted hooks',
    copy: 'Add native lifecycle checkpoints and bounded session-start context. Agent trust remains visible and under your control.',
    command: PRODUCT_COMMANDS.hooksInstall,
  },
  {
    icon: FileCheck2,
    title: 'Give Codex a real exit boundary',
    copy: 'Launch through Hamma for exact-session checkpoints on normal exit, failure, or forwarded terminal signals.',
    command: PRODUCT_COMMANDS.codex,
  },
  {
    icon: Bot,
    title: 'Switch or finish normally',
    copy: 'Move to Claude, Codex, or Grok with one command. Hamma reconciles Git and preserves task ownership automatically.',
    command: PRODUCT_COMMANDS.switchClaude,
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
            <code className="step-command">{command}</code>
          </article>
        ))}
      </div>
    </section>
  );
}
