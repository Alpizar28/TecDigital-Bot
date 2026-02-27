"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var playwright_extra_1 = require("playwright-extra");
var puppeteer_extra_plugin_stealth_1 = __importDefault(require("puppeteer-extra-plugin-stealth"));
playwright_extra_1.chromium.use((0, puppeteer_extra_plugin_stealth_1.default)());
function runInspector() {
    return __awaiter(this, void 0, void 0, function () {
        var browser, context, notificationEndpoint, requestHeaders, page, username, password, e_1, e_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, playwright_extra_1.chromium.launch({ headless: true })];
                case 1:
                    browser = _a.sent();
                    return [4 /*yield*/, browser.newContext({
                            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.7632.6 Safari/537.36'
                        })];
                case 2:
                    context = _a.sent();
                    notificationEndpoint = '';
                    requestHeaders = {};
                    return [4 /*yield*/, context.newPage()];
                case 3:
                    page = _a.sent();
                    page.on('request', function (request) {
                        var url = request.url();
                        if (url.includes('notific') || url.includes('api') || url.includes('ajax')) {
                            console.log("\n[Network] Intercepted Request: ".concat(request.method(), " ").concat(url));
                            if (url.includes('new-form')) {
                                console.log('\n[!] LOGIN POST REQUEST DETECTED:');
                                console.log("[!] POST HEADERS:", request.headers());
                                console.log("[!] POST BODY:", request.postData());
                            }
                            if (request.method() === 'POST' && url.includes('ajax')) {
                                console.log("\n[!] AJAX POST REQUEST DETECTED: ".concat(url));
                                console.log("[!] POST BODY:", request.postData());
                            }
                            if (url.includes('get_user_notifications') || url.includes('has_unread_notifications')) {
                                notificationEndpoint = url;
                                requestHeaders = request.headers();
                                console.log("[!] FOUND NOTIFICATION ENDPOINT: ".concat(url));
                                console.log("[!] HEADERS:", requestHeaders);
                            }
                        }
                    });
                    username = process.env.TEC_USER;
                    password = process.env.TEC_PASS;
                    if (!username || !password) {
                        console.error('Please set TEC_USER and TEC_PASS environment variables.');
                        process.exit(1);
                    }
                    _a.label = 4;
                case 4:
                    _a.trys.push([4, 18, 19, 21]);
                    console.log('[Inspector] Launching browser...');
                    console.log('[Inspector] Navigating to login...');
                    return [4 /*yield*/, page.goto('https://tecdigital.tec.ac.cr/dotlrn/', { waitUntil: 'networkidle', timeout: 30000 })];
                case 5:
                    _a.sent();
                    return [4 /*yield*/, page.fill('#mail-input', username)];
                case 6:
                    _a.sent();
                    return [4 /*yield*/, page.fill('#password-input', password)];
                case 7:
                    _a.sent();
                    return [4 /*yield*/, page.press('#password-input', 'Enter')];
                case 8:
                    _a.sent();
                    console.log('[Inspector] Waiting for login to complete...');
                    return [4 /*yield*/, page.waitForLoadState('networkidle', { timeout: 30000 })];
                case 9:
                    _a.sent();
                    console.log('[Inspector] Clicking notification bell to trigger the fetch...');
                    return [4 /*yield*/, page.click('#platform_user_notifications')];
                case 10:
                    _a.sent();
                    return [4 /*yield*/, page.waitForTimeout(3000)];
                case 11:
                    _a.sent();
                    console.log('[Inspector] Clicking the first delete button to sniff the delete endpoint...');
                    _a.label = 12;
                case 12:
                    _a.trys.push([12, 15, , 16]);
                    return [4 /*yield*/, page.waitForSelector('i.notification-delete', { state: 'visible', timeout: 5000 })];
                case 13:
                    _a.sent();
                    return [4 /*yield*/, page.click('i.notification-delete')];
                case 14:
                    _a.sent();
                    console.log('[Inspector] Delete clicked! Waiting for network response.');
                    return [3 /*break*/, 16];
                case 15:
                    e_1 = _a.sent();
                    console.log('[Inspector] No delete button found or timeout.');
                    return [3 /*break*/, 16];
                case 16: return [4 /*yield*/, page.waitForTimeout(4000)];
                case 17:
                    _a.sent();
                    return [3 /*break*/, 21];
                case 18:
                    e_2 = _a.sent();
                    console.error('Error during inspection:', e_2.message);
                    return [3 /*break*/, 21];
                case 19:
                    console.log('\n==================================================');
                    console.log('--- EXTRACTION COMPLETE ---');
                    console.log("Target Endpoint: ".concat(notificationEndpoint));
                    console.log("Required Headers to replicate:");
                    console.log(requestHeaders);
                    console.log('==================================================\n');
                    return [4 /*yield*/, browser.close()];
                case 20:
                    _a.sent();
                    return [7 /*endfinally*/];
                case 21: return [2 /*return*/];
            }
        });
    });
}
runInspector().catch(console.error);
