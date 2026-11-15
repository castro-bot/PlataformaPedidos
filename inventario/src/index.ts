import express, { Request, Response } from "express";

const PORT = Number(process.env.PORT ?? 3001);
const RETARDO_MS = Number(process.env.RETARDO_MS ?? 0);

const stock = new Map<string, number>([
    ["LAPTOP-14", 5],
    ["LAPTOP-1", 1],
    ["LAPTOP-2", 2],
    ["LAPTOP-3", 3],
    ["LAPTOP-4", 4],
    ["MOUSE-USB", 40],
]);

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", servicio: "inventario" });
});

app.get("/stock/:sku", async (req: Request<{ sku: string }>, res: Response) => {
    if (RETARDO_MS > 0) await esperar(RETARDO_MS);
    const disponible = stock.get(req.params.sku);
    if (disponible === undefined) {
        res.status(404).json({ error: "Sku no encontrado" + req.params.sku });
        return;
    }
    res.json({ sku: req.params.sku, disponible });
});

app.post("/stock/:sku/reservar", async (req: Request<{ sku: string }>, res: Response) => {
    const { cantidad } = req.body ?? {};
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
        res.status(400).json({ error: "cantidad debe ser un entero mayor que 0" });
        return;
    }

    const disponible = stock.get(req.params.sku);
    if (disponible === undefined) {
        res.status(404).json({ error: "Sku no encontrado" + req.params.sku });
        return;
    }

    if (RETARDO_MS > 0) await esperar(RETARDO_MS);

    const actual = stock.get(req.params.sku)!;
    if (actual < cantidad) {
        res.status(409).json({
            error: "No hay stock suficiente",
            sku: req.params.sku,
            disponible: actual,
            solicitado: cantidad,
        });
        return;
    }

    const restante = actual - cantidad;
    stock.set(req.params.sku, restante);
    res.json({ sku: req.params.sku, reservado: cantidad, restante });
});

app.listen(PORT, () => {
    console.log(`Servicio inventario escuchando en ${PORT}, retraso ${RETARDO_MS} ms`);
});