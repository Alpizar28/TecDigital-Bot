import 'dotenv/config';
import Fastify from 'fastify';
import cron from 'node-cron';
import { getPool, runMigrations } from '@tec-brain/database';
import { runOrchestrationCycle } from './orchestrator.js';

const PORT = parseInt(process.env.PORT ?? '3002', 10);
const CRON_SCHEDULE = process.env.CRON_SCHEDULE ?? '*/5 * * * *'; // Every 5 min

async function main() {
    // 1. Run DB migrations on startup
    console.log('[Core] Running database migrations...');
    await runMigrations();
    console.log('[Core] Migrations complete.');

    // 2. Start health check Fastify server
    const fastify = Fastify({ logger: { level: 'info' } });

    fastify.get('/health', async () => ({
        status: 'ok',
        uptime_s: Math.floor(process.uptime()),
    }));

    // Manual trigger for testing
    fastify.post('/api/run-now', async () => {
        setImmediate(() => void runOrchestrationCycle());
        return { status: 'triggered' };
    });

    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`[Core] Listening on port ${PORT}`);

    // 3. Schedule the cron
    if (!cron.validate(CRON_SCHEDULE)) {
        console.error(`[Core] Invalid CRON_SCHEDULE: "${CRON_SCHEDULE}"`);
        process.exit(1);
    }

    const job = cron.schedule(CRON_SCHEDULE, () => {
        console.log('[Cron] Running scheduled orchestration cycle...');
        void runOrchestrationCycle();
    });

    console.log(`[Core] Cron scheduled: "${CRON_SCHEDULE}"`);

    // 4. Run once immediately on startup
    console.log('[Core] Running initial orchestration cycle...');
    await runOrchestrationCycle();

    // 5. Graceful shutdown
    const shutdown = async () => {
        job.stop();
        await fastify.close();
        await getPool().end();
        process.exit(0);
    };

    process.on('SIGTERM', () => void shutdown());
    process.on('SIGINT', () => void shutdown());
}

main().catch((err: unknown) => {
    console.error('[Core] Fatal startup error:', err);
    process.exit(1);
});
