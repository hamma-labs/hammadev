import { ArrowRight, Check, Download, FileText, ShieldCheck } from 'lucide-react';

export default function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-heading">
      <div className="hero-copy">
        <div className="eyebrow"><span /> Persistent memory for coding agents</div>
        <h1 id="hero-heading">
          Switch AI coding agents <span>without losing context.</span>
        </h1>
        <p>
          Save, switch, and finish AI coding work with four plain commands.
          HammaDev handles sessions, task ownership, and repository memory underneath.
        </p>
        <p><code>hamma save</code> · <code>hamma switch claude</code> · <code>hamma done</code> · <code>hamma ask</code></p>

        <div className="hero-actions">
          <a
            href="https://www.npmjs.com/package/hammadev"
            target="_blank"
            rel="noopener noreferrer"
            className="primary-button"
            aria-label="npm install HammaDev alpha"
          >
            <Download size={18} />
            Install the alpha
          </a>
          <a
            href="https://github.com/xayrullonematov/hammadev"
            target="_blank"
            rel="noopener noreferrer"
            className="secondary-button"
          >
            View GitHub
            <ArrowRight size={18} />
          </a>
        </div>

        <div className="hero-proof">
          <span><ShieldCheck size={15} /> Local-only</span>
          <span><Check size={15} /> No account</span>
          <span className="agent-pill">Codex · Claude · Grok</span>
        </div>
      </div>

      <div className="hero-visual" aria-label="HammaDev handoff preview">
        <div className="orbit orbit-one" aria-hidden="true" />
        <div className="orbit orbit-two" aria-hidden="true" />
        <div className="agent-card codex-card">
          <div className="agent-symbol">C</div>
          <div><span>Source agent</span><strong>Codex</strong></div>
          <i className="live-dot" />
        </div>
        <div className="transfer-path" aria-hidden="true"><span className="transfer-dot" /></div>
        <div className="handoff-card">
          <div className="handoff-topline"><FileText size={16} /> memory:build-week <span>READY</span></div>
          <div className="document-lines">
            <span className="w-2/3" /><span className="w-full" /><span className="w-5/6" />
          </div>
          <div className="task-row"><Check size={14} /> Evidence-backed state</div>
          <div className="task-row"><Check size={14} /> Repository reconciled</div>
          <div className="artifact-stack">
            <span>bootstrap.md</span><span>memory-state.json</span><span>recall</span>
          </div>
        </div>
        <div className="agent-card claude-card">
          <div className="agent-symbol agent-symbol-warm">A</div>
          <div><span>Target agent</span><strong>Claude Code</strong></div>
          <ArrowRight size={16} />
        </div>
        <div className="privacy-chip"><ShieldCheck size={14} /> stays on your machine</div>
      </div>
    </section>
  );
}
