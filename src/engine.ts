import type {
  Algorithm,
  Level,
  Metrics,
  ProcessDefinition,
  RuntimeProcess,
  Segment,
  SimulationConfig,
  SimulationSnapshot,
  Zone,
} from './types';

/** Copia la configuración y, especialmente, el objeto anidado de algoritmos. */
const cloneConfig = (config: SimulationConfig): SimulationConfig => ({
  ...config,
  algorithms: { ...config.algorithms },
});

/** Reglas iniciales usadas al abrir la aplicación. */
export const DEFAULT_CONFIG: SimulationConfig = {
  quantum: 4,
  agingInterval: 5,
  agingEnabled: true,
  agingThreshold: 1,
  agingCondition: 'mayor_igual',
  algorithms: { 1: 'Prioridad', 2: 'SJF', 3: 'RR' },
};

/** Caso de ejemplo con el que se inicia la interfaz y que cubren las pruebas. */
export const SAMPLE_PROCESSES: ProcessDefinition[] = [
  { pid: 1, nombre: 'P1', arrivalTime: 0, totalBurst: 8, level: 1, initialPriority: 3, ioPoints: [3], ioDurations: [3] },
  { pid: 2, nombre: 'P2', arrivalTime: 2, totalBurst: 5, level: 1, initialPriority: 1, ioPoints: [], ioDurations: [] },
  { pid: 3, nombre: 'P3', arrivalTime: 0, totalBurst: 6, level: 2, initialPriority: 1, ioPoints: [2], ioDurations: [4] },
  { pid: 4, nombre: 'P4', arrivalTime: 0, totalBurst: 9, level: 3, initialPriority: 1, ioPoints: [4], ioDurations: [3] },
  { pid: 5, nombre: 'P5', arrivalTime: 5, totalBurst: 5, level: 3, initialPriority: 1, ioPoints: [], ioDurations: [] },
];

/** Crea el estado mutable de ejecución a partir de una definición inmutable. */
function runtimeFrom(definition: ProcessDefinition): RuntimeProcess {
  return {
    ...definition,
    nombre: definition.nombre.trim() || `P${definition.pid}`,
    ioPoints: [...definition.ioPoints],
    ioDurations: [...definition.ioDurations],
    initialPriority: Math.max(1, definition.initialPriority),
    currentPriority: Math.max(1, definition.initialPriority),
    remainingBurst: definition.totalBurst,
    totalCpuExecuted: 0,
    nextIoIndex: 0,
    state: 'Pendiente',
    queueEntryTime: definition.arrivalTime,
    hasRun: false,
    agingStepsApplied: 0,
    quantumUsed: 0,
    ioEndTime: null,
    isNewArrival: true,
    completionTime: null,
  };
}

/**
 * Simulador discreto de planificación con tres colas de prioridad fija.
 *
 * Cada llamada a `step` representa 1 ms. La clase mantiene sus colecciones
 * privadas y expone copias mediante `snapshot`, de modo que React no pueda
 * modificar accidentalmente el estado del planificador.
 */
export class SimulationEngine {
  // Reloj y colecciones que representan las posibles ubicaciones de un proceso.
  private time = 0;
  private all: RuntimeProcess[];
  private pending: RuntimeProcess[];
  private ready: Record<Level, RuntimeProcess[]> = { 1: [], 2: [], 3: [] };
  private blocked: RuntimeProcess[] = [];
  private finished: RuntimeProcess[] = [];
  private cpu: RuntimeProcess | null = null;
  private log: string[] = [];
  private history: Record<number, Segment[]>;
  private isFinished = false;
  private metrics: Metrics | null = null;
  private config: SimulationConfig;

  /** Inicializa procesos pendientes ordenados por llegada y, después, por PID. */
  constructor(definitions: ProcessDefinition[], config: SimulationConfig = DEFAULT_CONFIG) {
    this.config = cloneConfig(config);
    this.all = definitions.map(runtimeFrom);
    this.pending = [...this.all].sort((a, b) => a.arrivalTime - b.arrivalTime || a.pid - b.pid);
    this.history = Object.fromEntries(this.all.map((process) => [process.pid, []]));
  }

  /** Aplica ajustes en vivo y protege los valores que nunca pueden ser menores que 1. */
  updateConfig(next: Partial<Omit<SimulationConfig, 'algorithms'>> & { algorithms?: Partial<Record<Level, Algorithm>> }) {
    this.config = {
      ...this.config,
      ...next,
      quantum: Math.max(1, next.quantum ?? this.config.quantum),
      agingInterval: Math.max(1, next.agingInterval ?? this.config.agingInterval),
      algorithms: { ...this.config.algorithms, ...(next.algorithms ?? {}) },
    };
  }

  /** Añade al registro un mensaje prefijado con el instante simulado. */
  private register(message: string) {
    this.log.push(`[t=${String(this.time).padStart(5)} ms] ${message}`);
  }

  /**
   * Cierra el tramo anterior del Gantt y abre uno nuevo en la zona indicada.
   * El tramo queda abierto hasta el próximo cambio de zona.
   */
  private changeZone(process: RuntimeProcess, type: Zone, at = this.time) {
    const segments = this.history[process.pid] ?? (this.history[process.pid] = []);
    const open = segments.at(-1);
    if (open && open.end === null) open.end = at;
    segments.push({ type, start: at, end: null });
  }

  /** Coloca un proceso al final de su cola de nivel y reinicia su quantum. */
  private enqueue(process: RuntimeProcess, isNew: boolean) {
    process.state = 'Listo';
    process.isNewArrival = isNew;
    process.quantumUsed = 0;
    this.ready[process.level].push(process);
  }

  /**
   * Selecciona el mejor candidato de una cola según su algoritmo.
   * RR/FIFO respetan el orden; Prioridad y SJF ordenan una copia para no alterar
   * físicamente la cola mientras comparan candidatos.
   */
  private best(level: Level): RuntimeProcess | null {
    const queue = this.ready[level];
    if (!queue.length) return null;
    const algorithm = this.config.algorithms[level];
    if (algorithm === 'RR' || algorithm === 'FIFO') return queue[0];
    return [...queue].sort((a, b) => {
      const mainA = algorithm === 'Prioridad' ? a.currentPriority : a.remainingBurst;
      const mainB = algorithm === 'Prioridad' ? b.currentPriority : b.remainingBurst;
      return mainA - mainB || a.queueEntryTime - b.queueEntryTime || Number(a.isNewArrival) * -1 - Number(b.isNewArrival) * -1;
    })[0];
  }

  /** Retira el candidato de la cola, lo marca en ejecución y ocupa la CPU. */
  private startExecution(process: RuntimeProcess, level: Level) {
    this.ready[level] = this.ready[level].filter((candidate) => candidate !== process);
    process.state = 'Ejecución';
    process.hasRun = true;
    if (this.config.algorithms[level] === 'RR') process.quantumUsed = 0;
    this.cpu = process;
    this.changeZone(process, 'CPU');
    const priority = this.config.algorithms[level] === 'Prioridad' ? `, prioridad=${process.currentPriority}` : '';
    this.register(`P${process.pid} (nivel ${level}, alg=${this.config.algorithms[level]}) TOMA la CPU (ráfaga restante=${process.remainingBurst}ms${priority})`);
  }

  /** Devuelve el proceso actual a listos y entrega la CPU al nuevo candidato. */
  private preempt(current: RuntimeProcess, next: RuntimeProcess, nextLevel: Level) {
    current.state = 'Listo';
    current.isNewArrival = false;
    this.ready[current.level].push(current);
    this.changeZone(current, `Cola N${current.level}` as Zone);
    this.register(`P${next.pid} (nivel ${nextLevel}) DESALOJA a P${current.pid} (nivel ${current.level}) de la CPU`);
    this.startExecution(next, nextLevel);
  }

  /**
   * Decide si hay que asignar o desalojar la CPU.
   * Un nivel numéricamente menor siempre prevalece; dentro de la misma cola
   * Prioridad y SJF pueden provocar un desalojo inmediato.
   */
  private schedule() {
    if (!this.cpu) {
      for (const level of [1, 2, 3] as Level[]) {
        const candidate = this.best(level);
        if (candidate) return this.startExecution(candidate, level);
      }
      return;
    }
    for (let level = 1; level < this.cpu.level; level += 1) {
      const candidate = this.best(level as Level);
      if (candidate) return this.preempt(this.cpu, candidate, level as Level);
    }
    const algorithm = this.config.algorithms[this.cpu.level];
    const candidate = this.best(this.cpu.level);
    if (!candidate) return;

    // Prioridad usa el menor número y SJF la menor ráfaga restante. La
    // comparación es estricta para que un empate no desaloje innecesariamente.
    const hasBetterPriority = algorithm === 'Prioridad'
      && candidate.currentPriority < this.cpu.currentPriority;
    const hasShorterRemainingBurst = algorithm === 'SJF'
      && candidate.remainingBurst < this.cpu.remainingBurst;

    if (hasBetterPriority || hasShorterRemainingBurst) {
      this.preempt(this.cpu, candidate, this.cpu.level);
    }
  }

  /** Mejora periódicamente la prioridad de procesos elegibles que aún no ejecutaron. */
  private applyAging(at: number) {
    if (!this.config.agingEnabled) return;
    for (const level of [1, 2, 3] as Level[]) {
      if (this.config.algorithms[level] !== 'Prioridad') continue;
      for (const process of this.ready[level]) {
        if (process.hasRun) continue;
        // La condición de envejecimiento solo clasifica al proceso según su
        // prioridad inicial. Una vez elegible, continúa mejorando hasta que
        // obtiene la CPU por primera vez, aunque cruce el umbral configurado.
        const passes = this.config.agingCondition === 'mayor'
          ? process.initialPriority > this.config.agingThreshold
          : process.initialPriority >= this.config.agingThreshold;
        if (!passes) continue;
        const expectedSteps = Math.floor((at - process.queueEntryTime) / this.config.agingInterval);
        if (expectedSteps > process.agingStepsApplied) {
          const nextPriority = Math.max(1, process.currentPriority - (expectedSteps - process.agingStepsApplied));
          process.agingStepsApplied = expectedSteps;
          if (nextPriority < process.currentPriority) {
            process.currentPriority = nextPriority;
            this.register(`P${process.pid} ENVEJECE → nueva prioridad=${process.currentPriority}`);
          }
        }
      }
    }
  }

  /**
   * Avanza exactamente 1 ms siguiendo este orden:
   * llegadas y retornos de E/S → aging → planificación → consumo de CPU →
   * finalización, bloqueo o expiración de quantum.
   */
  step() {
    if (this.isFinished) return;
    const at = this.time;
    // Incorporar primero todos los procesos cuya llegada coincide con el reloj
    // actual. Así, si también termina una E/S en este instante, la llegada
    // nueva queda físicamente delante del retorno en la misma cola.
    while (this.pending[0]?.arrivalTime === at) {
      const process = this.pending.shift()!;
      process.queueEntryTime = at;
      this.enqueue(process, true);
      this.changeZone(process, `Cola N${process.level}` as Zone);
      this.register(`P${process.pid} LLEGA al sistema → cola Nivel ${process.level} (t_ingreso=${at}ms${process.level === 1 ? `, prioridad=${process.currentPriority}` : ''})`);
    }
    // Los retornos de E/S se añaden después de las llegadas y al final de cola.
    const stillBlocked: RuntimeProcess[] = [];
    for (const process of this.blocked) {
      if (process.ioEndTime === at) {
        process.queueEntryTime = at;
        this.enqueue(process, false);
        this.changeZone(process, `Cola N${process.level}` as Zone);
        this.register(`P${process.pid} TERMINA E/S → reingresa a cola Nivel ${process.level} (t_ingreso=${at}ms)`);
      } else stillBlocked.push(process);
    }
    this.blocked = stillBlocked;
    this.applyAging(at);
    this.schedule();

    // La CPU consume una unidad de ráfaga y evalúa el evento resultante.
    if (this.cpu) {
      const process = this.cpu;
      process.remainingBurst -= 1;
      process.totalCpuExecuted += 1;
      if (this.config.algorithms[process.level] === 'RR') process.quantumUsed += 1;
      const nextTime = at + 1;
      const done = process.remainingBurst <= 0;
      const requestsIo = !done && process.nextIoIndex < process.ioPoints.length && process.totalCpuExecuted >= process.ioPoints[process.nextIoIndex];
      const quantumExpired = !done && !requestsIo && this.config.algorithms[process.level] === 'RR' && process.quantumUsed >= this.config.quantum;
      if (done) {
        process.state = 'Terminado';
        process.completionTime = nextTime;
        this.finished.push(process);
        this.cpu = null;
        this.changeZone(process, 'Terminado', nextTime);
        this.register(`P${process.pid} FINALIZA su ejecución → Terminado (t=${nextTime}ms)`);
      }
      // `requestsIo` no puede coincidir con `done`; por eso se evalúa después.
      if (requestsIo) {
        const duration = process.ioDurations[process.nextIoIndex];
        process.nextIoIndex += 1;
        process.ioEndTime = nextTime + duration;
        process.state = 'Bloqueado (E/S)';
        this.blocked.push(process);
        this.cpu = null;
        this.changeZone(process, 'E/S', nextTime);
        this.register(`P${process.pid} SOLICITA E/S por ${duration}ms (retorna en t=${process.ioEndTime}ms)`);
      } else if (quantumExpired) {
        process.quantumUsed = 0;
        process.state = 'Listo';
        process.isNewArrival = false;
        this.ready[process.level].push(process);
        this.cpu = null;
        this.changeZone(process, `Cola N${process.level}` as Zone, nextTime);
        this.register(`P${process.pid} AGOTA su quantum → final de cola Nivel ${process.level}`);
      }
    }

    // El sistema termina cuando no queda trabajo en ninguna ubicación.
    this.time += 1;
    this.isFinished = !this.pending.length && !this.blocked.length && !this.cpu && ([1, 2, 3] as Level[]).every((level) => !this.ready[level].length);
    if (this.isFinished) this.calculateMetrics();
  }

  /** Ejecuta pasos hasta terminar o alcanzar el límite de seguridad. */
  runToEnd(limit = 100_000) {
    while (!this.isFinished && this.time < limit) this.step();
    return this.snapshot();
  }

  /** Calcula turnaround y espera por proceso, y después sus promedios. */
  private calculateMetrics() {
    if (!this.all.length || this.metrics) return;
    this.register('════ CÁLCULO DE TIEMPOS MEDIOS ════');
    const turnaround: number[] = [];
    const waiting: number[] = [];
    for (const process of [...this.all].sort((a, b) => a.pid - b.pid)) {
      const end = process.completionTime ?? this.time;
      const totalIo = process.ioDurations.reduce((sum, duration) => sum + duration, 0);
      const processTurnaround = end - process.arrivalTime;
      const processWaiting = processTurnaround - process.totalBurst - totalIo;
      turnaround.push(processTurnaround);
      waiting.push(processWaiting);
      this.register(`P${process.pid} (${process.nombre}) → T.Ejecución=${processTurnaround}ms · T.Espera=${processWaiting}ms`);
    }
    this.metrics = {
      averageTurnaround: turnaround.reduce((sum, value) => sum + value, 0) / this.all.length,
      averageWaiting: waiting.reduce((sum, value) => sum + value, 0) / this.all.length,
    };
    this.register(`Tiempo de ejecución medio = ${this.metrics.averageTurnaround.toFixed(2)}ms`);
    this.register(`Tiempo de espera medio = ${this.metrics.averageWaiting.toFixed(2)}ms`);
  }

  /** Devuelve copias superficiales suficientes para aislar a los consumidores. */
  snapshot(): SimulationSnapshot {
    return {
      time: this.time,
      all: [...this.all],
      ready: { 1: [...this.ready[1]], 2: [...this.ready[2]], 3: [...this.ready[3]] },
      blocked: [...this.blocked],
      finished: [...this.finished],
      cpu: this.cpu,
      log: [...this.log],
      history: Object.fromEntries(Object.entries(this.history).map(([pid, segments]) => [pid, segments.map((segment) => ({ ...segment }))])),
      isFinished: this.isFinished,
      metrics: this.metrics ? { ...this.metrics } : null,
      config: cloneConfig(this.config),
    };
  }
}
