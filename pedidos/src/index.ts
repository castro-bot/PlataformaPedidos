import express, { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import path from "node:path";
import { contarPrimos } from "./calculo";
import { medirLatencia, resumenMetricas } from "./metricas";

const PORT = Number(process.env.PORT ?? 3000);
const INVENTARIO_URL = process.env.INVENTARIO_URL ?? "http://localhost:3001";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 2000);
const REPORTE_N = Number(process.env.REPORTE_N ?? 8_000_000);

interface Pedidos {
    id: string;
    sku: string;
    cantidad: number;
    creadoEn: string;
}

const pedidos: Pedidos[] = [];
const app = express();
app.use(express.json());

app.use(medirLatencia);

app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", servicio: "pedidos" });
});

app.get("/metricas", (_req: Request, res: Response) => {
    res.json(resumenMetricas());
});

app.get("/pedidos", (_req: Request, res: Response) => {
    res.json(pedidos);
});

app.get("/health/ready", async (_req: Request, res: Response) => {
    const inicio = performance.now();
    try {
        const r = await fetch(INVENTARIO_URL + "/health", {
            signal: AbortSignal.timeout(1000),
        });
        const ms = Math.round(performance.now() - inicio);
        if (!r.ok) {
            res.status(503).json({ status: "no-listo", inventario: "http-" + r.status, ms });
            return;
        }
        res.json({ status: "listo", inventario: "ok", ms });
    } catch (error) {
        const ms = Math.round(performance.now() - inicio);
        const e = error as Error & { cause?: { code?: string } };
        const motivo =
            e.name === "TimeoutError"
                ? "timeout"
                : (e.cause?.code ?? e.message);
        res.status(503).json({ status: "no-listo", inventario: motivo, ms });
    }
});

app.post("/pedidos", async (req: Request, res: Response) => {
    const { sku, cantidad } = req.body ?? {};
    if (typeof sku !== "string" || !Number.isInteger(cantidad) || cantidad <= 0) {
        res.status(400).json({ error: "sku y cantidad no son los tipos correctos" });
        return;
    }

    const inicio = performance.now();
    try {
        const r = await fetch(
            INVENTARIO_URL + "/stock/" + encodeURIComponent(sku) + "/reservar",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cantidad }),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            }
        );

        if (r.status === 404) {
            res.status(404).json({ error: "Sku no encontrado" + sku });
            return;
        }

        if (r.status === 409) {
            const detalle = await r.json();
            res.status(409).json(detalle);
            return;
        }

        if (!r.ok) {
            res.status(502).json({ error: "respuesta inesperada de inventario", status: r.status });
            return;
        }

        await r.json(); // reserva ok
        const pedido: Pedidos = {
            id: randomUUID(),
            sku,
            cantidad,
            creadoEn: new Date().toISOString(),
        };
        pedidos.push(pedido);
        res.status(201).json(pedido);
    } catch (error) {
        const duracionMs = Math.round(performance.now() - inicio);
        const e = error as Error & { cause?: { code?: string } };
        const motivo =
            e.name === "TimeoutError"
                ? "inventario no respondio en " + TIMEOUT_MS + " ms"
                : "No se pudo conectar con inventario " + (e.cause?.code ?? e.message);
        console.error("pedidos " + motivo);
        res.status(503).json({ error: "inventario no disponible", motivo, duracionMs });
    }
});

function leerN(req: Request): number {
    const n = Number(req.query.n ?? REPORTE_N);
    return Number.isInteger(n) && n > 0 && n <= 50_000_000 ? n : REPORTE_N;
}

app.get("/reporte/bloqueante", (req: Request, res: Response) => {
    const n = leerN(req);
    const inicio = performance.now();
    const primos = contarPrimos(n);
    const duracionMs = Math.round(performance.now() - inicio);
    res.json({ modo: "bloqueando", n, primos, duracionMs });
});

function contarPrimosEnWorker(n: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const archivo = path.join(__dirname, "worker-reporte.js");
        const w = new Worker(archivo, { workerData: { n } });
        w.once("message", (primos: number) => resolve(primos));
        w.once("error", reject);
    });
}

app.get("/reporte/worker", async (req: Request, res: Response) => {
    const n = leerN(req);
    const inicio = performance.now();
    const primos = await contarPrimosEnWorker(n);
    const duracionMs = Math.round(performance.now() - inicio);
    res.json({ modo: "worker", n, primos, duracionMs });
});

app.listen(PORT, () => {
    console.log(
        `Servicio pedidos escuchando en ${PORT}, inventario en ${INVENTARIO_URL} timeout ${TIMEOUT_MS} ms`
    );
});
