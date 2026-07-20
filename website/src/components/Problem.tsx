import { ArrowDownRight } from 'lucide-react';

export default function Problem() {
  return (
    <section className="problem-strip" aria-labelledby="problem-heading">
      <div className="problem-label"><span>01</span> The context gap</div>
      <h2 id="problem-heading">Your code persists.<br />Your context should too.</h2>
      <div className="problem-copy">
        <p>
          Compaction, process exits, and agent switches should not erase the working
          thread. HammaDev preserves decisions, verification, risks, and the next
          action—not the transcript noise.
        </p>
        <a href="#workflow">See the continuity loop <ArrowDownRight size={17} /></a>
      </div>
    </section>
  );
}
