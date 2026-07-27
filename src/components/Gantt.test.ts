import { describe, expect, it } from 'vitest';
import type { RuntimeProcess, Segment } from '../types';
import { assignLanes } from './Gantt';

// Pruebas geométricas independientes del renderizado de React.
describe('assignLanes', () => {
  it('crea tantos carriles como procesos simultáneos y reutiliza los que se liberan', () => {
    const processes = [1, 2, 3, 4, 5].map((pid) => ({ pid }) as RuntimeProcess);
    const history: Record<number, Segment[]> = {
      1: [{ type: 'Cola N1', start: 0, end: 5 }],
      2: [{ type: 'Cola N1', start: 0, end: 5 }],
      3: [{ type: 'Cola N1', start: 1, end: 4 }],
      4: [{ type: 'Cola N1', start: 2, end: 3 }],
      5: [{ type: 'Cola N1', start: 5, end: 7 }],
    };

    const layout = assignLanes(processes, history, 'Cola N1', 7);

    expect(layout.laneCount).toBe(4);
    expect(new Set(layout.bars.slice(0, 4).map((bar) => bar.lane)).size).toBe(4);
    expect(layout.bars.find((bar) => bar.process.pid === 5)?.lane).toBe(0);
  });

  it('separa también las barras recién iniciadas que aún tienen duración cero', () => {
    // La duración visual mínima evita que dos tramos abiertos ocupen el mismo carril.
    const processes = [1, 2].map((pid) => ({ pid }) as RuntimeProcess);
    const history: Record<number, Segment[]> = {
      1: [{ type: 'E/S', start: 4, end: null }],
      2: [{ type: 'E/S', start: 4, end: null }],
    };

    expect(assignLanes(processes, history, 'E/S', 4).laneCount).toBe(2);
  });
});
