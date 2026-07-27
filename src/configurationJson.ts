import { ALGORITHMS, type Level, type ProcessDefinition, type SimulationConfig } from './types';

/** Información que se restaura al importar un archivo de configuración. */
export interface ImportedConfiguration {
  processes: ProcessDefinition[];
  config: SimulationConfig;
  speed: number;
  zoom: number;
}

interface ConfigurationFile extends ImportedConfiguration {
  /** Permite cambiar el formato en el futuro sin interpretar archivos antiguos incorrectamente. */
  version: 1;
}

// JSON.parse devuelve `unknown`; estos ayudantes validan el tipo antes de usarlo.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function record(value: unknown, label: string) {
  if (!isRecord(value)) throw new Error(`${label} debe ser un objeto.`);
  return value;
}

function integer(source: Record<string, unknown>, property: string, minimum?: number) {
  const value = source[property];
  if (!Number.isInteger(value) || (minimum != null && (value as number) < minimum)) {
    throw new Error(`La propiedad “${property}” no es válida.`);
  }
  return value as number;
}

function numberArray(source: Record<string, unknown>, property: string, minimum: number) {
  const value = source[property];
  if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item) || item < minimum)) {
    throw new Error(`La propiedad “${property}” debe ser una lista de enteros válidos.`);
  }
  return value as number[];
}

/** Serializa procesos, planificación y preferencias visuales en JSON legible. */
export function configurationJson(
  processes: ProcessDefinition[],
  config: SimulationConfig,
  speed: number,
  zoom: number,
) {
  const file: ConfigurationFile = { version: 1, speed, zoom, processes, config };
  return JSON.stringify(file, null, 2);
}

/**
 * Convierte un texto JSON en una configuración segura.
 *
 * La validación es deliberadamente estricta: impide que datos incompletos o
 * incoherentes lleguen al motor y produzcan resultados difíciles de explicar.
 */
export function parseConfigurationJson(text: string): ImportedConfiguration {
  // Primera etapa: comprobar que el texto sea JSON sintácticamente válido.
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('El archivo no contiene JSON válido.');
  }

  const root = record(parsed, 'La configuración');
  if (root.version !== 1) throw new Error('La versión de la configuración no es compatible.');
  if (!Array.isArray(root.processes) || !root.processes.length) throw new Error('El archivo no contiene procesos.');

  // Segunda etapa: validar y normalizar cada definición de proceso.
  const processes = root.processes.map((value, index): ProcessDefinition => {
    const process = record(value, `El proceso ${index + 1}`);
    const pid = integer(process, 'pid', 1);
    const nombre = typeof process.nombre === 'string' && process.nombre.trim() ? process.nombre.trim() : `P${pid}`;
    const ioPoints = numberArray(process, 'ioPoints', 1);
    const ioDurations = numberArray(process, 'ioDurations', 0);
    const totalBurst = integer(process, 'totalBurst', 1);
    const level = integer(process, 'level', 1);

    if (level > 3) throw new Error('Los niveles de cola deben estar entre 1 y 3.');
    if (ioPoints.length !== ioDurations.length) throw new Error(`El proceso P${pid} debe tener una duración por cada punto de E/S.`);
    if (ioPoints.some((point, pointIndex) => point > totalBurst || (pointIndex > 0 && point < ioPoints[pointIndex - 1]))) {
      throw new Error('Los puntos de E/S deben ser crecientes y no superar la ráfaga.');
    }

    return {
      pid,
      nombre,
      arrivalTime: integer(process, 'arrivalTime', 0),
      totalBurst,
      level: level as Level,
      initialPriority: integer(process, 'initialPriority', 1),
      ioPoints,
      ioDurations,
    };
  });

  if (new Set(processes.map((process) => process.pid)).size !== processes.length) throw new Error('Los PID deben ser únicos.');

  // Tercera etapa: verificar las reglas de planificación de las tres colas.
  const configSource = record(root.config, 'La planificación');
  const algorithmsSource = record(configSource.algorithms, 'Los algoritmos');
  const algorithms = {} as SimulationConfig['algorithms'];
  for (const level of [1, 2, 3] as Level[]) {
    const algorithm = algorithmsSource[level];
    if (!ALGORITHMS.some((candidate) => candidate === algorithm)) throw new Error(`El algoritmo del nivel ${level} no es válido.`);
    algorithms[level] = algorithm as SimulationConfig['algorithms'][Level];
  }

  if (typeof configSource.agingEnabled !== 'boolean') throw new Error('La propiedad “agingEnabled” no es válida.');
  if (configSource.agingCondition !== 'mayor' && configSource.agingCondition !== 'mayor_igual') {
    throw new Error('La condición de envejecimiento no es válida.');
  }

  // Las preferencias visuales también se limitan a rangos utilizables.
  const speed = root.speed;
  const zoom = root.zoom;
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) throw new Error('La velocidad no es válida.');
  if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom < 10 || zoom > 120) throw new Error('El zoom debe estar entre 10 y 120.');

  return {
    processes,
    speed,
    zoom,
    config: {
      quantum: integer(configSource, 'quantum', 1),
      agingEnabled: configSource.agingEnabled,
      agingInterval: integer(configSource, 'agingInterval', 1),
      agingCondition: configSource.agingCondition,
      agingThreshold: integer(configSource, 'agingThreshold'),
      algorithms,
    },
  };
}
