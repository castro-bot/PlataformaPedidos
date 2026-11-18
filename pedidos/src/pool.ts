import { Worker } from "node:worker_threads";
import path from "node:path";
import os from "node:os";

const MAX_TRABAJADORES = Number(
  process.env.MAX_TRABAJADORES ?? os.availableParallelism()
);
const MAX_COLA = Number(process.env.MAX_COLA ?? MAX_TRABAJADORES * 2);

interface Trabajo {
  n: number;
  resolve: (primos: number) => void;
  reject: (err: Error) => void;
}

let activos = 0;
let rechazadas = 0;
const cola: Trabajo[] = [];

function lanzarWorker(trabajo: Trabajo): void {
  activos += 1;
  const archivo = path.join(__dirname, "worker-reporte.js");
  const w = new Worker(archivo, { workerData: { n: trabajo.n } });
  w.once("message", (primos: number) => {
    trabajo.resolve(primos);
    activos -= 1;
    despacharSiguiente();
  });
  w.once("error", (err: Error) => {
    trabajo.reject(err);
    activos -= 1;
    despacharSiguiente();
  });
}

function despacharSiguiente(): void {
  if (activos >= MAX_TRABAJADORES) return;
  const siguiente = cola.shift();
  if (!siguiente) return;
  lanzarWorker(siguiente);
}

export function contarPrimosEnPool(n: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const trabajo: Trabajo = { n, resolve, reject };

    if (activos < MAX_TRABAJADORES) {
      lanzarWorker(trabajo);
      return;
    }

    if (cola.length >= MAX_COLA) {
      rechazadas += 1;
      const err = new Error("Pool lleno");
      err.name = "PoolLleno";
      reject(err);
      return;
    }

    cola.push(trabajo);
  });
}

export function estadoPool() {
  return {
    maxTrabajadores: MAX_TRABAJADORES,
    activos,
    enCola: cola.length,
    maxCola: MAX_COLA,
    rechazadas,
  };
}
