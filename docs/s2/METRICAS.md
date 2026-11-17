# Métricas · Interceptor de Pedidos

## Experimento

1. `GET http://localhost:3000/reporte/bloqueante?n=250000` → `200 OK`, ~2.4 s (`duracionMs`: 2352)
2. `GET http://localhost:3000/health` (enviada enseguida, mientras el reporte seguía)
3. `GET http://localhost:3000/metricas`

## Resultado de `/health` (cliente)

| Dato | Valor |
| --- | --- |
| Código de estado | `200 OK` |
| Tiempo (Insomnia / Postman) | `1.4 s` |

## Respuesta de `/metricas`

```json
{
  "umbralLentaMs": 1000,
  "rutas": [
    {
      "ruta": "GET /reporte/bloqueante",
      "peticiones": 1,
      "promedioMs": 2357.31625,
      "maxMs": 2357.31625,
      "lentas": 1
    },
    {
      "ruta": "GET /health",
      "peticiones": 1,
      "promedioMs": 1.531372000000374,
      "maxMs": 1.531372000000374,
      "lentas": 0
    },
    {
      "ruta": "GET /metricas",
      "peticiones": 1,
      "promedioMs": 1.5506700000005367,
      "maxMs": 1.5506700000005367,
      "lentas": 0
    }
  ]
}
```

## ¿Por qué el cliente y el interceptor miden distinto a `/health`, y qué fallo ve el cliente?

El cliente midió **1.4 s** en `/health`, pero el interceptor solo registró **~1.5 ms**. Eso pasa porque Insomnia/Postman cuenta desde que envía la petición hasta que llega la respuesta (incluye la espera mientras el event loop está ocupado con `/reporte/bloqueante`). El interceptor empieza a medir cuando Express ya pudo ejecutar el middleware y termina en `res.on("finish")`, o sea solo el tiempo real del handler una vez libre el bucle. El cliente no ve un error 5xx en `/health`: ve latencia alta / “colgado”, un fallo de disponibilidad por head-of-line blocking del event loop.
