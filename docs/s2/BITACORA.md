# Bitácora · Arquitecturas y procesos · Adolfo Castro

## Entorno
| Dato | Valor |
| --- | --- |
| Laptop (CPU, RAM) | 11th Gen Intel Core i7-1165G7 @ 2.80 GHz, 16 GB RAM |
| nucleos según /metricas | 8 |
| MAX_TRABAJADORES y MAX_COLA | 8 y 16 (por defecto: availableParallelism y el doble) |
| Duración de un reporte con n=2000000 | ~139637 ms (~2 min 7 s) en `/reporte/pool` |

## 1. Resultados
| Escenario | Latencia 50 % | Latencia máx. | Respuestas 2xx | Respuestas 503 | Timeouts | bucle.maxMs |
| --- | --- | --- | --- | --- | --- | --- |
| 1 · bloqueo (/health) | 4 ms | 85 ms | ~4320–4341 | 0 | 20 | 129789 |
| 2 · worker sin límite | 0 ms | 0 ms | 0 | 0 | 100 | 165 |
| 3 · pool con límite | 19 ms | 533 ms | 0 | ~36074 | 24 | 141 |

### Escenario 1 · salida autocannon

```
Running 15s test @ http://localhost:3000/health
20 connections

Latency 50%: 4 ms | Max: 85 ms | Avg: 4.99 ms
4k requests in 13.86s, 1.17 MB read
20 errors (20 timeouts)
```

### Escenario 1 · /metricas

```json
{"umbralLentaMs":1000,"nucleos":8,"bucle":{"p50Ms":11,"p99Ms":12,"maxMs":129789},"rutas":[{"ruta":"GET /health","peticiones":4341,"promedioMs":0.17879135452658693,"maxMs":3.9874820000004547,"lentas":0},{"ruta":"GET /reporte/bloqueante","peticiones":1,"promedioMs":129778.87955199998,"maxMs":129778.87955199998,"lentas":1}],"pool":{"maxTrabajadores":8,"activos":0,"enCola":0,"maxCola":16,"rechazadas":0}}
```

Nota: solo alcancé a enviar **una** petición a `/reporte/bloqueante` durante los 15 s (con `n=2000000` tarda ~2 min).

### Escenario 2 · salida autocannon

```
Running 20s test @ http://localhost:3000/reporte/worker?n=2000000
50 connections

Latency 50%: 0 ms | Max: 0 ms
150 requests in 18.55s, 0 B read
100 errors (100 timeouts)
```

### Escenario 2 · /metricas

```json
{"umbralLentaMs":1000,"nucleos":8,"bucle":{"p50Ms":11,"p99Ms":39,"maxMs":165},"rutas":[],"pool":{"maxTrabajadores":8,"activos":0,"enCola":0,"maxCola":16,"rechazadas":0}}
```

### Escenario 3 · salida autocannon

```
Running 20s test @ http://localhost:3000/reporte/pool?n=2000000
50 connections

Latency 50%: 19 ms | Max: 533 ms | Avg: 20.56 ms
0 2xx responses, 36074 non 2xx responses
36k requests in 17.87s, 14.2 MB read
24 errors (24 timeouts)
```

### Escenario 3 · /metricas

```json
{"umbralLentaMs":1000,"nucleos":8,"bucle":{"p50Ms":10,"p99Ms":36,"maxMs":141},"rutas":[{"ruta":"GET /reporte/pool","peticiones":36124,"promedioMs":0.3982423262097178,"maxMs":23.1270370000002,"lentas":0}],"pool":{"maxTrabajadores":8,"activos":8,"enCola":16,"maxCola":16,"rechazadas":36124}}
```

## 2. Análisis

**Escenario 1 — bucle.maxMs vs maxMs de GET /health.**  
`bucle.maxMs` fue **129789 ms** y el `maxMs` de `GET /health` en `rutas` solo **~4 ms**. El monitor del event loop ve el retardo real del bucle mientras `/reporte/bloqueante` ocupa el hilo principal (~2 min con n=2000000). El interceptor de latencia de `/health` solo cuenta desde que Express ya pudo atender esa petición hasta el `finish`; las que quedaron en cola durante el bloqueo no “inflan” ese maxMs, y las que sí se atendieron fueron rápidas. Por eso el bucle detecta el bloqueo y la métrica por ruta de `/health` no. El cliente, en cambio, sí sufre timeouts (20 en autocannon).

**Escenario 2 — completadas vs timeouts.**  
Se lanzaron peticiones con 50 conexiones durante 20 s; **0** respuestas útiles (0 B leídos) y **100 timeouts**. Un solo reporte con n=2000000 tarda ~2 minutos en esta máquina; con 50 a la vez se crean decenas de workers sin tope, cada uno compitiendo por CPU. Aunque un reporte aislado “tarde menos de un segundo” en otros `n`, aquí la sobrecarga (contexto, memoria, contención) hace que casi nada termine dentro del timeout de autocannon. `rutas` quedó vacío porque ninguna respuesta alcanzó a cerrarse a tiempo.

**Escenario 3 — 2xx vs 503 y modelos de fallo.**  
Hubo **0** respuestas 2xx y del orden de **36074** non-2xx (503 por pool lleno; `rechazadas: 36124`). Un **503 inmediato con Retry-After** es un fallo explícito y controlado: el cliente sabe que debe esperar y reintentar; no consume un worker eterno. Un **timeout** es un fallo de latencia/disponibilidad sin respuesta útil: el cliente no sabe si el trabajo sigue, falló o hay que reenviar. El pool convierte sobrecarga en rechazo rápido (fail-fast) en lugar de colas infinitas.

**autocannon e Retry-After.**  
autocannon ignora `Retry-After` y vuelve a pegar enseguida; eso mantuvo el pool saturado (`activos: 8`, `enCola: 16`) y disparó decenas de miles de rechazos. Un cliente bien diseñado debería respetar `Retry-After` (o backoff), limitar concurrencia y no martillar un 503.

**Réplicas y estado en memoria.**  
Con 3 réplicas detrás de un balanceador, cada proceso tendría su propio `/metricas`, su propio `bucle` y su propio `pool` (no hay vista global). El máximo de reportes simultáneos sería ~3 × MAX_TRABAJADORES (aquí ~24), más colas locales. Cambiaría: métricas centralizadas (Prometheus/etc.), límites globales o cola compartida, y sticky/routing consciente de carga si hace falta.

## 3. Problemas encontrados

- Con `n=2000000`, un reporte tarda ~2 minutos; en el escenario 1 solo pude disparar **una** petición bloqueante dentro de los 15 s de autocannon.
- En el escenario 2, autocannon (20 s) es demasiado corto frente a la duración real del worker: casi todo termina en timeout y `/metricas` puede quedar sin rutas.
- En el escenario 3, la avalancha de 503 por reintentos agresivos de autocannon satura contadores (`rechazadas`) aunque el diseño del pool sea el esperado.

## 4. Uso declarado de IA

Se usó Cursor (asistente de código) para implementar `monitorEventLoopDelay` en `metricas.ts`, el despachador en `pool.ts`, la ruta `/reporte/pool`, y para redactar/estructurar esta bitácora a partir de las salidas reales de autocannon y `/metricas` obtenidas en esta máquina. Las mediciones y capturas las ejecuté yo.
