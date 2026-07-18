import { AlertTriangle } from 'lucide-react';

const limitations = [
  'Three source adapters today',
  'Conservative, heuristic extraction',
  'Explicit memory sync without a trusted hook',
  'Local-machine scope',
  'Best-effort secret redaction',
];

export default function Limitations() {
  return (
    <section className="limitations-section" aria-labelledby="limitations-heading">
      <div>
        <div className="section-kicker"><AlertTriangle size={14} /> Honest alpha boundaries</div>
        <h2 id="limitations-heading">Useful today.<br />Still deliberately narrow.</h2>
      </div>
      <ul>
        {limitations.map((limitation, index) => (
          <li key={limitation}><span>0{index + 1}</span>{limitation}</li>
        ))}
      </ul>
    </section>
  );
}
