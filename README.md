# OrbitOS — migración web del simulador

Esta carpeta contiene una versión nueva e independiente en React + TypeScript. Los archivos Python originales del directorio padre no se modifican ni se sustituyen.

## Ejecutar

```bash
npm install
npm run dev
```

Para validar lógica y compilación:

```bash
npm test
npm run build
```

## Funciones migradas

- Motor discreto de 1 ms con jerarquía fija N1 > N2 > N3.
- Prioridad apropiativa, SJF, Round Robin y FIFO por cola.
- Cambio de configuración durante la simulación.
- Envejecimiento configurable hasta la primera ejecución.
- Llegadas, E/S, retornos, quantum y desempate de llegada nueva.
- Gestión visual de procesos antes de iniciar.
- Gantt por zonas con carriles, zoom y seguimiento automático.
- Estado de colas, inspector, registro, historial y métricas finales.

El test automatizado reproduce el escenario de ejemplo de Python y comprueba sus mismos resultados finales.

## Guía para leer el código

El proyecto está documentado con comentarios por bloques y JSDoc en las
funciones principales. Un orden recomendado de lectura es:

1. `src/types.ts`: define el vocabulario común (procesos, estados, segmentos,
   configuración, métricas e instantáneas).
2. `src/engine.ts`: contiene toda la lógica del planificador. El método `step`
   avanza exactamente 1 ms y es el centro de la simulación.
3. `src/App.tsx`: conecta el motor con React, administra los controles y
   compone los paneles de la interfaz.
4. `src/components/Gantt.tsx`: transforma el historial del motor en barras y
   carriles de una línea temporal.
5. `src/components/ProcessModal.tsx`: captura y valida las definiciones de
   procesos.
6. `src/configurationJson.ts`: exporta e importa configuraciones, validando
   cada dato antes de entregarlo al motor.
7. Los archivos `*.test.ts` documentan mediante ejemplos el comportamiento
   que debe conservarse.

### Ciclo de un paso de simulación

En cada milisegundo el motor procesa, en orden:

1. Llegadas de procesos y retornos de E/S.
2. Envejecimiento de prioridades.
3. Selección o desalojo de la CPU.
4. Consumo de 1 ms de ráfaga.
5. Finalización, solicitud de E/S o expiración del quantum.
6. Incremento del reloj y comprobación de fin.

Las colecciones internas del motor son privadas. La interfaz recibe una
`SimulationSnapshot`, es decir, una copia segura del estado actual que puede
renderizar sin alterar la simulación.
