import axios, { AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import type { RawNotification } from '@tec-brain/types';

export class TecHttpClient {
    public readonly client: AxiosInstance;
    public readonly jar: CookieJar;

    constructor() {
        this.jar = new CookieJar();

        // Wrap Axios with cookiejar support
        this.client = wrapper(axios.create({
            jar: this.jar,
            withCredentials: true,
            timeout: 30000,
            headers: {
                'sec-ch-ua-platform': '"Windows"',
                'referer': 'https://tecdigital.tec.ac.cr/',
                'accept-language': 'en-US,en;q=0.9',
                'sec-ch-ua': '" Not;A Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
                'sec-ch-ua-mobile': '?0',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.7632.6 Safari/537.36'
            }
        }));
    }

    /**
     * Authenticates the client using pure JSON API payload.
     * Returns true if successful.
     */
    async login(email: string, password: string): Promise<boolean> {
        try {
            const loginUrl = 'https://tecdigital.tec.ac.cr/api/login/new-form/';
            const payload = {
                email,
                password,
                returnUrl: '/dotlrn/'
            };

            const response = await this.client.post(loginUrl, payload, {
                headers: {
                    'Content-Type': 'application/json;charset=UTF-8',
                    'Accept': 'application/json, text/plain, */*',
                    'Origin': 'https://tecdigital.tec.ac.cr',
                    'Referer': 'https://tecdigital.tec.ac.cr/register/?return_url=/dotlrn/',
                },
                maxRedirects: 5
            });

            console.log(`[TecHttpClient] POST Login status: ${response.status}`);

            if (response.status === 200) {
                // The login API might only set ad_session_id. We need to visit the dashboard to mint the JSESSIONID from Tomcat
                await this.client.get('https://tecdigital.tec.ac.cr/dotlrn/');

                const cookies = await this.jar.getCookies('https://tecdigital.tec.ac.cr/');
                console.log(`[TecHttpClient] Cookies after /dotlrn/:`, cookies.map(c => `${c.key}=...`));
                return cookies.some(c => c.key === 'JSESSIONID' || c.key === 'ad_session_id');
            }
            return false;
        } catch (error) {
            console.error('[TecHttpClient] Login Error:', error instanceof Error ? error.message : String(error));
            if (axios.isAxiosError(error) && error.response) {
                console.error('[TecHttpClient] Error response status:', error.response.status);
                console.error('[TecHttpClient] Error response data:', error.response.data);
            }
            return false;
        }
    }
}
