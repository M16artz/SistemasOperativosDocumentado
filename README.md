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

## Arquitectura general

La aplicación está separada en tres capas:

1. **Presentación:** `App.tsx`, `ProcessModal.tsx`, `Gantt.tsx` y
   `styles.css`. Esta capa muestra información y recibe acciones del usuario.
2. **Dominio:** `engine.ts` contiene las reglas de planificación y `types.ts`
   define las estructuras de datos compartidas.
3. **Persistencia local:** `configurationJson.ts` convierte la configuración
   a JSON y valida los archivos que el usuario importa.

React nunca modifica directamente las colecciones internas del motor.
`SimulationEngine` mantiene el estado mutable y entrega una
`SimulationSnapshot`, que es una copia segura utilizada para actualizar la
interfaz.

## Cómo están comunicados los archivos

El punto de entrada y las dependencias principales siguen este recorrido:

```text
index.html
    │ contiene <div id="root">
    ▼
src/main.tsx
    │ monta React e importa los estilos globales
    ▼
src/App.tsx
    ├── crea y controla ──────────────► src/engine.ts
    │                                      │
    │                                      ├── usa los contratos de src/types.ts
    │                                      └── devuelve SimulationSnapshot
    │
    ├── muestra el historial ─────────► src/components/Gantt.tsx
    ├── crea/edita procesos ──────────► src/components/ProcessModal.tsx
    ├── importa/exporta archivos ─────► src/configurationJson.ts
    └── usa tipos compartidos ────────► src/types.ts
```

La comunicación entre los módulos se realiza de la siguiente manera:

- `main.tsx` importa `App` y lo monta dentro del elemento `#root` de
  `index.html`.
- `App.tsx` conserva en estado las definiciones de procesos, la configuración,
  el motor activo y su última instantánea.
- Cuando comienza una simulación, `App.tsx` crea una instancia de
  `SimulationEngine` con los procesos y la configuración actuales.
- Después de cada llamada a `engine.step()`, `App.tsx` solicita
  `engine.snapshot()` y guarda el resultado en React mediante `setSnapshot`.
- El nuevo `snapshot` provoca un renderizado. La tabla, las colas, el
  inspector, las métricas, el registro y `Gantt` reciben así el estado más
  reciente.
- `ProcessModal` no modifica directamente la lista. Al guardar llama a
  `onSave`, función proporcionada por `App`, y el componente raíz actualiza las
  definiciones.
- `Gantt` recibe `snapshot`, `zoom` y `follow` como propiedades. Devuelve los
  cambios de zoom y seguimiento mediante `onZoom` y `onFollow`.
- `configurationJson.ts` recibe datos desde `App` para exportarlos. En una
  importación devuelve datos ya validados, y `App` reemplaza su configuración
  y reinicia cualquier simulación anterior.
- `types.ts` no ejecuta lógica: establece los contratos TypeScript que permiten
  que todos los módulos intercambien datos con la misma estructura.

## Flujo completo de ejecución

### 1. Carga inicial

1. El navegador abre `index.html`.
2. Vite carga el módulo `src/main.tsx`.
3. `main.tsx` importa los estilos, crea la raíz de React y renderiza `App`.
4. `App` carga los procesos de ejemplo y la configuración predeterminada
   definidos en `engine.ts`.
5. Todavía no existe un motor activo. La interfaz muestra los procesos como
   definidos y espera una acción del usuario.

### 2. Preparación de la simulación

Antes de iniciar, el usuario puede:

- Agregar, editar o eliminar procesos mediante `ProcessModal`.
- Elegir un algoritmo distinto para cada nivel.
- Configurar quantum, velocidad y envejecimiento.
- Importar un archivo JSON validado por `parseConfigurationJson`.
- Exportar los valores actuales con `configurationJson`.

La edición de procesos queda deshabilitada cuando ya existe un motor, para no
cambiar las definiciones a mitad de una ejecución. Los ajustes de planificación
sí pueden enviarse al motor mediante `updateConfig`.

### 3. Inicio y temporización

Al pulsar **Iniciar simulación**:

1. `App.start()` crea `new SimulationEngine(definitions, config)`.
2. El constructor convierte cada `ProcessDefinition` en un `RuntimeProcess`.
3. Los procesos se ordenan por tiempo de llegada y PID.
4. Se crea un historial vacío para cada proceso.
5. `App` guarda la primera instantánea y activa `running`.
6. Un `useEffect` programa un temporizador con la velocidad seleccionada.
7. Al vencer el temporizador se ejecuta un paso de 1 ms, se obtiene otra
   instantánea y React vuelve a renderizar.

Se programa un solo temporizador por renderizado. Esto evita que varios
intervalos avancen el motor al mismo tiempo. Los controles **Paso +1 ms** y
**Hasta el final** llaman al mismo motor, pero avanzan de forma manual o
continua sin esperar la animación.

### 4. Flujo de eventos dentro de cada milisegundo

El método `SimulationEngine.step()` procesa los eventos en este orden:

1. **Llegadas:** mueve a la cola correspondiente todos los procesos cuyo
   `arrivalTime` coincide con el reloj.
2. **Retornos de E/S:** los procesos cuyo `ioEndTime` ha llegado abandonan el
   estado bloqueado y vuelven a su cola de nivel.
3. **Envejecimiento:** mejora la prioridad de los procesos elegibles que
   esperan en una cola configurada con el algoritmo de prioridad.
4. **Planificación:** busca qué proceso debe ocupar la CPU.
   - Los niveles tienen jerarquía fija: N1 tiene preferencia sobre N2 y N2
     sobre N3.
   - `Prioridad` elige el menor valor numérico.
   - `SJF` elige la menor ráfaga restante.
   - `RR` y `FIFO` respetan el orden físico de la cola.
5. **Desalojo:** un proceso de nivel superior puede quitar la CPU al proceso
   actual. Dentro de una cola de prioridad también puede desalojar un candidato
   con mejor prioridad.
6. **Ejecución:** el proceso en CPU reduce su ráfaga restante en 1 ms y aumenta
   su CPU acumulada.
7. **Evento posterior a la CPU:** se comprueba, en este orden, si el proceso:
   - terminó toda su ráfaga;
   - alcanzó un punto de solicitud de E/S;
   - agotó el quantum de Round Robin.
8. **Historial y registro:** cada cambio de zona cierra el segmento anterior,
   abre uno nuevo y genera un mensaje con el tiempo simulado.
9. **Avance del reloj:** el tiempo aumenta 1 ms.
10. **Comprobación de fin:** la simulación termina cuando no hay procesos
    pendientes, listos, bloqueados ni ocupando la CPU.

### 5. Actualización de la interfaz

Después de cada paso, `snapshot()` copia:

- el reloj;
- todos los procesos y su estado;
- las tres colas de listos;
- los procesos bloqueados y terminados;
- el proceso que ocupa la CPU;
- el registro de eventos;
- el historial de segmentos;
- la configuración y las métricas.

`App` utiliza esa copia para actualizar todos los paneles. `Gantt` transforma
los segmentos del historial en barras y los reparte en carriles cuando varios
procesos coinciden en la misma zona.

### 6. Finalización y métricas

Cuando termina el último proceso, el motor calcula:

- **Tiempo de ejecución o turnaround:** tiempo de finalización menos tiempo de
  llegada.
- **Tiempo de espera:** turnaround menos ráfaga de CPU menos tiempo total de
  E/S.
- **Promedios:** suma de los valores individuales dividida entre el número de
  procesos.

Las métricas quedan almacenadas en la instantánea final y se muestran en los
paneles de resultados y en el diálogo de cálculos completos.

## Qué se define en cada archivo

### Archivos de la aplicación

| Archivo | Responsabilidad |
| --- | --- |
| `index.html` | Documento HTML inicial. Define metadatos, el título, el nodo `#root` y la carga de `main.tsx`. |
| `src/main.tsx` | Punto de entrada de React. Importa `App`, carga `styles.css` y monta la aplicación usando `createRoot`. |
| `src/App.tsx` | Componente raíz. Administra procesos, configuración, reproducción, importación, selección y diálogos. Conecta todos los módulos. |
| `src/types.ts` | Define algoritmos, niveles, estados, zonas, procesos, segmentos, configuración, métricas y la forma de una instantánea. |
| `src/engine.ts` | Implementa el simulador discreto, las colas, selección de CPU, desalojos, E/S, Round Robin, aging, historial y métricas. También contiene el ejemplo y configuración iniciales. |
| `src/configurationJson.ts` | Serializa la configuración y valida de manera estricta los JSON importados antes de aceptarlos. |
| `src/components/ProcessModal.tsx` | Formulario modal para crear o editar un proceso. Convierte y valida tiempos, prioridad y listas de E/S. |
| `src/components/Gantt.tsx` | Representa el historial como línea temporal. Calcula colores, carriles sin solapamientos, zoom y seguimiento automático. |
| `src/styles.css` | Contiene el tema visual, distribución de paneles, tabla, Gantt, formularios, modales y reglas adaptables para diferentes pantallas. |
| `src/vite-env.d.ts` | Incorpora a TypeScript los tipos proporcionados por Vite. No contiene lógica de ejecución. |

### Archivos de pruebas

| Archivo | Qué comprueba |
| --- | --- |
| `src/engine.test.ts` | Resultados del caso de ejemplo, funcionamiento del aging y normalización de prioridades inválidas. |
| `src/configurationJson.test.ts` | Exportación/importación completa y rechazo de archivos o procesos incoherentes. |
| `src/components/Gantt.test.ts` | Cálculo y reutilización de carriles, incluidos segmentos abiertos con duración visual mínima. |

### Configuración y documentación

| Archivo | Responsabilidad |
| --- | --- |
| `package.json` | Identifica el proyecto, declara dependencias y define los comandos `dev`, `test`, `build` y `preview`. |
| `package-lock.json` | Fija las versiones exactas instaladas para obtener instalaciones reproducibles. Se genera automáticamente con npm. |
| `vite.config.ts` | Activa el complemento de React y configura rutas relativas para poder publicar la carpeta compilada. |
| `tsconfig.json` | Configuración TypeScript raíz que referencia las configuraciones de aplicación y herramientas. |
| `tsconfig.app.json` | Reglas de TypeScript aplicadas al código que se ejecuta en el navegador. |
| `tsconfig.node.json` | Reglas de TypeScript para archivos ejecutados por Node, como `vite.config.ts`. |
| `.gitignore` | Indica qué archivos generados o locales no deben guardarse en Git. |
| `README.md` | Explica instalación, arquitectura, comunicación, flujo de eventos y estructura del proyecto. |
| `ANALISIS_MIGRACION.md` | Documenta las decisiones y correspondencias de la migración desde el simulador original. |

Las carpetas `node_modules` y `dist` no contienen código fuente que deba
editarse manualmente. `node_modules` guarda dependencias instaladas y `dist`
contiene el resultado generado por `npm run build`.

## Orden recomendado de lectura

Para estudiar el proyecto de lo general a lo específico:

1. `src/types.ts`
2. `src/engine.ts`
3. `src/engine.test.ts`
4. `src/App.tsx`
5. `src/components/ProcessModal.tsx`
6. `src/components/Gantt.tsx`
7. `src/configurationJson.ts`
8. `src/styles.css`
