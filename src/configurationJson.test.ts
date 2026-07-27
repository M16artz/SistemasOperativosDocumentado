import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, SAMPLE_PROCESSES } from './engine';
import { configurationJson, parseConfigurationJson } from './configurationJson';

// Comprueba tanto el viaje de ida y vuelta como las validaciones de frontera.
describe('configurationJson', () => {
  it('exporta e importa toda la configuración sin perder datos', () => {
    const text = configurationJson(SAMPLE_PROCESSES, DEFAULT_CONFIG, 300, 30);
    const imported = parseConfigurationJson(text);

    expect(JSON.parse(text).version).toBe(1);
    expect(imported).toEqual({
      processes: SAMPLE_PROCESSES,
      config: DEFAULT_CONFIG,
      speed: 300,
      zoom: 30,
    });
  });

  it('rechaza texto que no sea JSON', () => {
    expect(() => parseConfigurationJson('<simulacion />')).toThrow('JSON válido');
  });

  it('rechaza procesos con puntos y duraciones de E/S desbalanceados', () => {
    // Se altera una exportación válida para aislar exactamente esta inconsistencia.
    const file = JSON.parse(configurationJson(SAMPLE_PROCESSES, DEFAULT_CONFIG, 300, 30));
    file.processes[0].ioDurations = [];

    expect(() => parseConfigurationJson(JSON.stringify(file))).toThrow('una duración por cada punto');
  });

  it('rechaza prioridades iniciales menores que 1', () => {
    const file = JSON.parse(configurationJson(SAMPLE_PROCESSES, DEFAULT_CONFIG, 300, 30));
    file.processes[0].initialPriority = 0;

    expect(() => parseConfigurationJson(JSON.stringify(file))).toThrow('initialPriority');
  });
});
