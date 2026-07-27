/**
 * Contratos de datos compartidos por el motor, la interfaz y las pruebas.
 * Mantenerlos en un único módulo evita que cada capa describa la simulación
 * de una forma distinta.
 */

/** Algoritmos que el usuario puede seleccionar desde la interfaz. */
export const ALGORITHMS = ['Prioridad', 'SJF', 'RR'] as const;

/** FIFO se conserva como opción interna, aunque no aparezca en el selector. */
export type Algorithm = (typeof ALGORITHMS)[number] | 'FIFO';
export type Level = 1 | 2 | 3;
export type ProcessState = 'Pendiente' | 'Listo' | 'Ejecución' | 'Bloqueado (E/S)' | 'Terminado';
export type Zone = 'CPU' | 'Cola N1' | 'Cola N2' | 'Cola N3' | 'E/S' | 'Terminado';

/** Datos inmutables introducidos por el usuario para definir un proceso. */
export interface ProcessDefinition {
  pid: number;
  nombre: string;
  arrivalTime: number;
  level: Level;
  initialPriority: number;
  totalBurst: number;
  /** Instantes de CPU acumulada en los que el proceso solicita E/S. */
  ioPoints: number[];
  /** Duración correspondiente a cada posición de `ioPoints`. */
  ioDurations: number[];
}

/** Definición enriquecida con los valores que cambian durante la ejecución. */
export interface RuntimeProcess extends ProcessDefinition {
  currentPriority: number;
  remainingBurst: number;
  totalCpuExecuted: number;
  nextIoIndex: number;
  state: ProcessState;
  /** Instante de la última entrada a una cola; se usa para desempates y aging. */
  queueEntryTime: number;
  hasRun: boolean;
  agingStepsApplied: number;
  quantumUsed: number;
  ioEndTime: number | null;
  isNewArrival: boolean;
  completionTime: number | null;
}

/** Intervalo temporal ocupado por un proceso en una zona del sistema. */
export interface Segment {
  type: Zone;
  start: number;
  /** `null` significa que el proceso todavía permanece en esta zona. */
  end: number | null;
}

/** Reglas configurables del planificador multinivel. */
export interface SimulationConfig {
  quantum: number;
  agingInterval: number;
  agingEnabled: boolean;
  agingThreshold: number;
  agingCondition: 'mayor' | 'mayor_igual';
  algorithms: Record<Level, Algorithm>;
}

/** Resultados agregados, disponibles cuando todos los procesos terminan. */
export interface Metrics {
  averageTurnaround: number;
  averageWaiting: number;
}

/**
 * Copia observable del motor. La UI consume este objeto en lugar de acceder a
 * sus estructuras privadas y mutables.
 */
export interface SimulationSnapshot {
  time: number;
  all: RuntimeProcess[];
  ready: Record<Level, RuntimeProcess[]>;
  blocked: RuntimeProcess[];
  finished: RuntimeProcess[];
  cpu: RuntimeProcess | null;
  log: string[];
  history: Record<number, Segment[]>;
  isFinished: boolean;
  metrics: Metrics | null;
  config: SimulationConfig;
}
