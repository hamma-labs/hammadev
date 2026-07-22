import { Check, Copy, PackageCheck } from 'lucide-react';
import { useState } from 'react';
import { PRODUCT_COMMANDS, PRODUCT_INSTALL_COMMAND } from '../product';

export default function Install() {
  const [copied, setCopied] = useState(false);

  async function copyInstallCommand() {
    await navigator.clipboard.writeText(PRODUCT_INSTALL_COMMAND);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section id="install" className="install-section" aria-labelledby="install-heading">
      <div>
        <div className="section-kicker"><PackageCheck size={14} /> Start locally</div>
        <h2 id="install-heading" className="section-title">From install to native continuity in minutes.</h2>
        <p className="install-intro">Requires Node.js 22.12+; Node 24 is recommended. The package is <code>hammadev</code> and the CLI is <code>hamma</code>.</p>
      </div>

      <div className="install-panel">
        <div className="install-command">
          <span>$</span>
          <code>{PRODUCT_INSTALL_COMMAND}</code>
          <button type="button" onClick={copyInstallCommand} aria-label="Copy install command">
            {copied ? <Check size={17} /> : <Copy size={17} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
        <ol className="install-steps">
          {[
            ['01', 'Preview every project change', PRODUCT_COMMANDS.setupCheck],
            ['02', 'Apply and verify setup', PRODUCT_COMMANDS.setupApply],
            ['03', 'Enable project memory explicitly', PRODUCT_COMMANDS.save],
            ['04', 'Launch with exact-session recovery', PRODUCT_COMMANDS.codex],
          ].map(([number, label, command]) => (
            <li key={command}>
              <span>{number}</span>
              <div><strong>{label}</strong><code>{command}</code></div>
              <Check size={16} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
