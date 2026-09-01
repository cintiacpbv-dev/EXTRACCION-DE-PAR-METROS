/**
 * Worker local: llama a POST /api/worker/tick en bucle hasta que no
 * queden jobs pendientes. Requiere que el servidor Next.js esté
 * corriendo (`npm run dev` o `npm start`) — este script es solo un
 * cliente HTTP, no importa código de servidor directamente (así
 * conservamos la protección `server-only` en lib/supabase/admin.ts sin
 * que reviente al ejecutarse fuera del bundler de Next).
 *
 *   npm run worker
 *   WORKER_BASE_URL=http://localhost:3010 npm run worker
 */

const baseUrl = process.env.WORKER_BASE_URL ?? 'http://localhost:3000';

async function main() {
  console.log(`Worker iniciado. Objetivo: ${baseUrl}/api/worker/tick`);

  for (;;) {
    const res = await fetch(`${baseUrl}/api/worker/tick`, { method: 'POST' });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`tick falló (${res.status}): ${body}`);
    }
    const result = await res.json();

    if (!result.processed) {
      console.log('No hay jobs en cola. Saliendo.');
      break;
    }
    if (result.error) {
      console.log(`[${result.documentId}] etapa=${result.stage} ERROR: ${result.error}`);
    } else {
      console.log(`[${result.documentId}] etapa=${result.stage} done=${result.done}`);
    }
  }

  console.log('Worker terminado.');
}

main().catch((err) => {
  console.error('Worker falló:', err);
  process.exit(1);
});
