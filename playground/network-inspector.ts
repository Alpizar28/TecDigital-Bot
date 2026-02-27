import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

async function runInspector() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.7632.6 Safari/537.36'
    });

    let notificationEndpoint = '';
    let requestHeaders: Record<string, string> = {};

    const page = await context.newPage();

    page.on('request', (request) => {
        const url = request.url();
        if (url.includes('notific') || url.includes('api') || url.includes('ajax')) {
            console.log(`\n[Network] Intercepted Request: ${request.method()} ${url}`);

            if (url.includes('new-form')) {
                console.log('\n[!] LOGIN POST REQUEST DETECTED:');
                console.log(`[!] POST HEADERS:`, request.headers());
                console.log(`[!] POST BODY:`, request.postData());
            }

            if (request.method() === 'POST' && url.includes('ajax')) {
                console.log(`\n[!] AJAX POST REQUEST DETECTED: ${url}`);
                console.log(`[!] POST BODY:`, request.postData());
            }

            if (url.includes('get_user_notifications') || url.includes('has_unread_notifications')) {
                notificationEndpoint = url;
                requestHeaders = request.headers();
                console.log(`[!] FOUND NOTIFICATION ENDPOINT: ${url}`);
                console.log(`[!] HEADERS:`, requestHeaders);
            }
        }
    });

    const username = process.env.TEC_USER;
    const password = process.env.TEC_PASS;

    if (!username || !password) {
        console.error('Please set TEC_USER and TEC_PASS environment variables.');
        process.exit(1);
    }

    try {
        console.log('[Inspector] Launching browser...');
        console.log('[Inspector] Navigating to login...');
        await page.goto('https://tecdigital.tec.ac.cr/dotlrn/', { waitUntil: 'networkidle', timeout: 30000 });

        await page.fill('#mail-input', username);
        await page.fill('#password-input', password);
        await page.press('#password-input', 'Enter');

        console.log('[Inspector] Waiting for login to complete...');
        await page.waitForLoadState('networkidle', { timeout: 30000 });

        console.log('[Inspector] Clicking notification bell to trigger the fetch...');
        await page.click('#platform_user_notifications');

        await page.waitForTimeout(3000);

        console.log('[Inspector] Clicking the first delete button to sniff the delete endpoint...');
        try {
            await page.waitForSelector('i.notification-delete', { state: 'visible', timeout: 5000 });
            await page.click('i.notification-delete');
            console.log('[Inspector] Delete clicked! Waiting for network response.');
        } catch (e) {
            console.log('[Inspector] No delete button found or timeout.');
        }

        await page.waitForTimeout(4000);

    } catch (e) {
        console.error('Error during inspection:', (e as Error).message);
    } finally {
        console.log('\n==================================================');
        console.log('--- EXTRACTION COMPLETE ---');
        console.log(`Target Endpoint: ${notificationEndpoint}`);
        console.log(`Required Headers to replicate:`);
        console.log(requestHeaders);
        console.log('==================================================\n');

        await browser.close();
    }
}

runInspector().catch(console.error);
