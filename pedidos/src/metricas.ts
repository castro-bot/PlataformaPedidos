// Interceptor que mide cada petición (tarea en clase).
import { Request, Response, NextFunction } from "express";
import { monitorEventLoopDelay } from "node:perf_hooks";
import os from "node:os";

const UMBRAL_LENTA_MS = Number(process.env.UMBRAL_LENTA_MS ?? 1000);

const retardoBucle = monitorEventLoopDelay({ resolution: 10 });
retardoBucle.enable();

interface Estadistica {
  peticiones: number;
  totalMs: number;
  maxMs: number;
  lentas: number;
}

const porRuta = new Map<string, Estadistica>();

export function medirLatencia(req: Request, res: Response, next: NextFunction): void {
  const inicio = performance.now();
  res.on("finish", () => {
    const ms = performance.now() - inicio;
    const clave = `${req.method} ${req.path}`;
    const e = porRuta.get(clave) ?? {
      peticiones: 0,
      totalMs: 0,
      maxMs: 0,
      lentas: 0,
    };
    e.peticiones += 1;
    e.totalMs += ms;
    e.maxMs = Math.max(e.maxMs, ms);
    if (ms > UMBRAL_LENTA_MS) e.lentas += 1;
    porRuta.set(clave, e);
  });
  next(); // sin next(), la petición nunca llega a la ruta
}

export function resumenMetricas() {
  return {
    umbralLentaMs: UMBRAL_LENTA_MS,
    nucleos: os.availableParallelism(),
    bucle: {
      p50Ms: Math.round(retardoBucle.percentile(50) / 1e6),
      p99Ms: Math.round(retardoBucle.percentile(99) / 1e6),
      maxMs: Math.round(retardoBucle.max / 1e6),
    },
    rutas: [...porRuta].map(([ruta, e]) => ({
      ruta,
      peticiones: e.peticiones,
      promedioMs: e.peticiones === 0 ? 0 : e.totalMs / e.peticiones,
      maxMs: e.maxMs,
      lentas: e.lentas,
    })),
  };
}
