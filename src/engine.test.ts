import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, SAMPLE_PROCESSES, SimulationEngine } from './engine';

// Pruebas de regresión de las reglas esenciales del planificador.
describe('SimulationEngine', () => {
  it('reproduce los resultados del ejemplo con la política actual', () => {
    // Si cambia la secuencia de planificación, también cambiarán estos resultados.
    const result = new SimulationEngine(SAMPLE_PROCESSES, DEFAULT_CONFIG).runToEnd();
    expect(result.time).toBe(35);
    expect(result.metrics?.averageTurnaround).toBe(19.8);
    expect(result.metrics?.averageWaiting).toBe(11.2);
    expect(result.all.map((process) => process.completionTime)).toEqual([16, 7, 20, 35, 28]);
  });

  it('aplica envejecimiento según la prioridad inicial hasta la primera ejecución', () => {
    // P1 ocupa la CPU mientras P2 mejora dos veces: prioridad 3 → 2 → 1.
    const processes = [
      { pid: 1, nombre: 'P1', arrivalTime: 0, totalBurst: 10, level: 1 as const, initialPriority: 1, ioPoints: [], ioDurations: [] },
      { pid: 2, nombre: 'P2', arrivalTime: 0, totalBurst: 1, level: 1 as const, initialPriority: 3, ioPoints: [], ioDurations: [] },
    ];
    const config = {
      ...DEFAULT_CONFIG,
      agingInterval: 1,
      agingThreshold: 2,
      agingCondition: 'mayor_igual' as const,
      algorithms: { ...DEFAULT_CONFIG.algorithms },
    };

    const result = new SimulationEngine(processes, config).runToEnd();
    const agingEvents = result.log.filter((line) => line.includes('P2 ENVEJECE'));

    expect(agingEvents).toHaveLength(2);
    expect(agingEvents.map((line) => line.match(/prioridad=(-?\d+)/)?.[1])).toEqual(['2', '1']);
    expect(result.all.every((process) => process.currentPriority >= 1)).toBe(true);
    expect(result.all.find((process) => process.pid === 2)?.completionTime).toBe(11);
  });

  it('normaliza a 1 cualquier prioridad inválida recibida directamente por el motor', () => {
    // El motor se protege incluso si la entrada no pasó por el formulario o JSON.
    const processes = [
      { pid: 1, nombre: 'P1', arrivalTime: 0, totalBurst: 1, level: 1 as const, initialPriority: -3, ioPoints: [], ioDurations: [] },
    ];

    const result = new SimulationEngine(processes, DEFAULT_CONFIG).runToEnd();

    expect(result.all[0].initialPriority).toBe(1);
    expect(result.all[0].currentPriority).toBe(1);
  });

  it('desaloja en SJF cuando llega un proceso con menor ráfaga restante', () => {
    const processes = [
      { pid: 1, nombre: 'P1', arrivalTime: 0, totalBurst: 6, level: 2 as const, initialPriority: 1, ioPoints: [], ioDurations: [] },
      { pid: 2, nombre: 'P2', arrivalTime: 2, totalBurst: 1, level: 2 as const, initialPriority: 1, ioPoints: [], ioDurations: [] },
    ];
    const config = {
      ...DEFAULT_CONFIG,
      algorithms: { ...DEFAULT_CONFIG.algorithms, 2: 'SJF' as const },
    };

    const result = new SimulationEngine(processes, config).runToEnd();

    // P2 llega en t=2 y toma la CPU antes de que P1 consuma el intervalo 2→3.
    expect(result.all.map((process) => process.completionTime)).toEqual([7, 3]);
    expect(result.log.some((line) => line.includes('P2 (nivel 2) DESALOJA a P1'))).toBe(true);
    expect(result.history[1].filter((segment) => segment.type === 'CPU')).toEqual([
      { type: 'CPU', start: 0, end: 2 },
      { type: 'CPU', start: 3, end: 7 },
    ]);
  });

  it('reingresa al final de la cola un RR desalojado por un nivel superior', () => {
    const processes = [
      { pid: 1, nombre: 'RR en CPU', arrivalTime: 0, totalBurst: 5, level: 3 as const, initialPriority: 1, ioPoints: [], ioDurations: [] },
      { pid: 2, nombre: 'RR en espera', arrivalTime: 0, totalBurst: 5, level: 3 as const, initialPriority: 1, ioPoints: [], ioDurations: [] },
      { pid: 3, nombre: 'Nivel superior', arrivalTime: 1, totalBurst: 1, level: 1 as const, initialPriority: 1, ioPoints: [], ioDurations: [] },
    ];
    const config = {
      ...DEFAULT_CONFIG,
      quantum: 10,
      algorithms: { ...DEFAULT_CONFIG.algorithms, 1: 'FIFO' as const, 3: 'RR' as const },
    };
    const engine = new SimulationEngine(processes, config);

    engine.step(); // t=0: P1 toma la CPU y P2 permanece esperando en N3.
    engine.step(); // t=1: P3 desaloja a P1, que debe ubicarse detrás de P2.

    expect(engine.snapshot().ready[3].map((process) => process.pid)).toEqual([2, 1]);
  });

  it('inserta una llegada simultánea antes que un retorno de E/S', () => {
    const processes = [
      { pid: 1, nombre: 'Retorno', arrivalTime: 0, totalBurst: 3, level: 1 as const, initialPriority: 1, ioPoints: [1], ioDurations: [1] },
      { pid: 2, nombre: 'En CPU', arrivalTime: 1, totalBurst: 5, level: 1 as const, initialPriority: 1, ioPoints: [], ioDurations: [] },
      { pid: 3, nombre: 'Llegada', arrivalTime: 2, totalBurst: 1, level: 1 as const, initialPriority: 1, ioPoints: [], ioDurations: [] },
    ];
    const config = {
      ...DEFAULT_CONFIG,
      algorithms: { ...DEFAULT_CONFIG.algorithms, 1: 'FIFO' as const },
    };
    const engine = new SimulationEngine(processes, config);

    engine.step(); // t=0: P1 ejecuta y solicita E/S hasta t=2.
    engine.step(); // t=1: P2 ocupa la CPU.
    engine.step(); // t=2: P3 llega antes de que P1 retorne de E/S.

    expect(engine.snapshot().ready[1].map((process) => process.pid)).toEqual([3, 1]);
  });
});
