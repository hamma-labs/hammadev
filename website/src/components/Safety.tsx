import { Eye, HardDrive, ShieldCheck, WifiOff } from 'lucide-react';

export default function Safety() {
  return (
    <section className="safety-section" aria-labelledby="safety-heading">
      <div className="safety-orbit" aria-hidden="true" />
      <div className="safety-copy">
        <div className="section-kicker light"><ShieldCheck size={14} /> Local-first by design</div>
        <h2 id="safety-heading">Your session never needs to leave your machine.</h2>
        <p>HammaDev reads agent session files locally and writes memory, hook settings, and recovery records inside your project. There is no backend, account, cloud sync, or telemetry in the alpha.</p>
        <div className="safety-note"><Eye size={17} /><span><strong>Review before sharing.</strong> Redaction is best-effort, not a privacy guarantee.</span></div>
      </div>
      <div className="safety-points">
        <div><HardDrive size={20} /><span><strong>Local files</strong>.hamma/ stays in your project</span></div>
        <div><WifiOff size={20} /><span><strong>No backend</strong><em>No cloud sync</em></span></div>
        <div><ShieldCheck size={20} /><span><strong>Non-destructive</strong>Source sessions stay untouched</span></div>
        <div><Eye size={20} /><span><strong>Trust-controlled</strong>Native hook commands remain reviewable</span></div>
      </div>
    </section>
  );
}
