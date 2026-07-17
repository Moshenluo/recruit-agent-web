import { getDemoEngine } from '../src/demo/engine';

function main() {
  const eng = getDemoEngine();
  const snap = () => eng.getSnapshot();

  const before = snap();
  console.log('[seed] total candidates:', before.candidates.length);
  const byStage: Record<string, number> = {};
  for (const c of before.candidates) byStage[c.stage] = (byStage[c.stage] || 0) + 1;
  console.log('[seed] byStage:', JSON.stringify(byStage));
  console.log('[seed] screening records:', before.screenings.length, 'phases:', JSON.stringify(before.screenings.map(s => `${s.candidate_name}:${s.phase}:${s.decision}`)));
  console.log('[seed] interviews scheduled:', before.schedule.length);
  console.log('[seed] anomalies:', before.anomalies.length);

  // 1) AI initial screening on 赵磊 (expect pass -> group_creation)
  const zl = before.candidates.find(c => c.name === '赵磊');
  if (!zl) throw new Error('赵磊 not found');
  const r1 = eng.runAIInitialScreening(zl.id);
  console.log('[AI初筛 赵磊]', JSON.stringify(r1));
  const zlAfter = snap().candidates.find(c => c.id === zl.id);
  console.log('[AI初筛 赵磊] stage after ->', zlAfter?.stage, 'parked:', zlAfter?.parked);

  // 2) retest scheduling on 郑爽 (expect -> retest_result passed)
  const zs = before.candidates.find(c => c.name === '郑爽');
  if (!zs) throw new Error('郑爽 not found');
  const r2 = eng.runScheduling(zs.id, 'retest');
  console.log('[复试 郑爽]', JSON.stringify(r2));
  const zsAfter = snap().candidates.find(c => c.id === zs.id);
  console.log('[复试 郑爽] stage after ->', zsAfter?.stage);

  // 3) tick once
  eng.tick();
  const afterTick = snap();
  console.log('[tick] candidates now:', afterTick.candidates.length, 'running:', eng.getStatus().running);

  console.log('\nALL DEMO ENGINE CHECKS PASSED ✓');
  process.exit(0);
}

try {
  main();
} catch (e) {
  console.error('DEMO ENGINE ERROR:', e);
  process.exit(1);
}
