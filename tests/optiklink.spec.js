// tests/optiklink.spec.js
const { test, chromium } = require('@playwright/test');
const https = require('https');

// 注意：DISCORD_ACCOUNT 变量直接填入你的 Discord Token
const discordToken = process.env.DISCORD_ACCOUNT ? process.env.DISCORD_ACCOUNT.trim() : '';
const [panelUser, panelPass] = (process.env.PANEL_ACCOUNT || ',').split(',');
const [TG_CHAT_ID, TG_TOKEN] = (process.env.TG_BOT || ',').split(',');

const TIMEOUT = 60000;

function nowStr() {
    return new Date().toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).replace(/\//g, '-');
}

function sendTG(result, serverName = 'OptikLink') {
    return new Promise((resolve) => {
        if (!TG_CHAT_ID || !TG_TOKEN) {
            console.log('⚠️ TG_BOT 未配置，跳过推送');
            return resolve();
        }

        const msg = [
            `🎮 OptikLink 保活通知`,
            `🕐 运行时间: ${nowStr()}`,
            `🖥 服务器: ${serverName}`,
            `📊 执行结果: ${result}`,
        ].join('\n');

        const body = JSON.stringify({ chat_id: TG_CHAT_ID, text: msg });
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${TG_TOKEN}/sendMessage`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        }, (res) => {
            if (res.statusCode === 200) {
                console.log('📨 TG 推送成功');
            } else {
                console.log(`⚠️ TG 推送失败：HTTP ${res.statusCode}`);
            }
            resolve();
        });

        req.on('error', (e) => {
            console.log(`⚠️ TG 推送异常：${e.message}`);
            resolve();
        });

        req.setTimeout(15000, () => {
            console.log('⚠️ TG 推送超时');
            req.destroy();
            resolve();
        });

        req.write(body);
        req.end();
    });
}

// 处理 Discord OAuth 授权页
async function handleOAuthPage(page) {
    await page.waitForTimeout(2000);

    for (let i = 0; i < 5; i++) {
        if (!page.url().includes('discord.com')) return;

        try {
            const btn = await page.waitForSelector('button.primary_a22cb0', { timeout: 5000 });
            const text = (await btn.innerText()).trim();

            if (/scroll/i.test(text) || text.includes('滚动')) {
                await page.evaluate(() => {
                    const s = document.querySelector('[class*="scroller"]')
                        || document.querySelector('[class*="scrollerBase"]')
                        || document.querySelector('[class*="content"]');
                    if (s) s.scrollTop = s.scrollHeight;
                    window.scrollTo(0, document.body.scrollHeight);
                });
                await page.waitForTimeout(1500);
                await btn.click();
                await page.waitForTimeout(1500);
            } else if (/authorize/i.test(text) || text.includes('授权')) {
                await btn.click();
                await page.waitForTimeout(5000);
                return;
            } else {
                await page.waitForTimeout(1500);
            }
        } catch {
            try {
                await page.waitForURL(url => !url.toString().includes('discord.com'), { timeout: 10000 });
            } catch { /* 继续等待 */ }
            return;
        }
    }
}

test('OptikLink 保活', async ({ }, testInfo) => {
    if (!discordToken) {
        throw new Error('❌ 缺少账号配置，请在 DISCORD_ACCOUNT 中填入 Discord Token');
    }

    let proxyConfig = undefined;
    if (process.env.GOST_PROXY) {
        try {
            const http = require('http');
            await new Promise((resolve, reject) => {
                const req = http.request(
                    { host: '127.0.0.1', port: 8080, path: '/', method: 'GET', timeout: 3000 },
                    () => resolve()
                );
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
                req.end();
            });
            proxyConfig = { server: process.env.GOST_PROXY };
            console.log('🛡️ 本地代理连通，使用 Xray 转发');
        } catch {
            console.log('⚠️ 本地代理不可达，降级为直连');
        }
    }

    console.log('🔧 启动浏览器...');
    const browser = await chromium.launch({
        headless: true,
        proxy: proxyConfig,
    });
    
    // ✅ 强力注入：创建一个忽略证书错误的浏览器上下文，拦截解密型代理报错
    const context = await browser.newContext({
        ignoreHTTPSErrors: true
    });
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT);
    let activePage = page;

    // 基础防广告与弹窗机制
    await page.addInitScript(() => {
        if (!location.hostname.includes('optiklink')) return;
        window.open = function () { return null; };
    });

    console.log('🚀 浏览器就绪！');

    try {
        console.log('🌐 验证出口 IP...');
        try {
            const res = await page.goto('https://api.ipify.org?format=json', { waitUntil: 'domcontentloaded', timeout: 10000 });
            const body = await res.text();
            console.log(`✅ 出口 IP 确认：${body}`);
        } catch {
            console.log('⚠️ IP 验证超时，跳过');
        }

        console.log('🔑 正在打开 Discord 进行 Token 注入...');
        await page.goto('https://discord.com/login', { waitUntil: 'domcontentloaded' });
        
        console.log('💉 注入 Token...');
        await page.evaluate((token) => {
            function login(token) {
                setInterval(() => {
                    document.body.appendChild(document.createElement(`iframe`)).contentWindow.localStorage.token = `"${token}"`;
                }, 50);
                setTimeout(() => {
                    location.reload();
                }, 2500);
            }
            login(token);
        }, discordToken);

        console.log('⏳ 等待 Token 登录完成并跳转...');
        await page.waitForTimeout(5000); 

        console.log('🛰️ 登录完毕，直接冲向 Discord OAuth 授权源地址...');
        await page.goto('https://discord.com/oauth2/authorize?client_id=1130456108169904169&redirect_uri=https%3A%2F%2Foptiklink.net%2Fauth%2Fcallback&response_type=code&scope=identify%20email%20guilds%20guilds.join', { waitUntil: 'domcontentloaded', timeout: 45000 });

        // 处理可能出现的 OAuth 授权确认按钮
        console.log(`📱 当前位置: ${page.url()}，检查是否需要点击授权...`);
        if (page.url().includes('discord.com/oauth2')) {
            console.log('🔍 进入 OAuth 确认授权页，处理中...');
            await handleOAuthPage(page);
        }

        console.log('⏳ 确认回调并尝试到达 OptikLink Dashboard...');
        try {
            await page.waitForURL(url => url.toString().includes('optiklink'), { timeout: 30000 });
        } catch { /* 忽略超时 */ }

        // 遭遇重定向错页自愈
        if (page.url().includes('chrome-error') || !page.url().includes('optiklink')) {
            console.log('⚠️ 检测到处于网络错误页或未正确回调，尝试跨步强制自愈...');
        }

        console.log(`✅ 当前页面 URL 状态: ${page.url()}`);

        // ====== 🔥 【利用已经完成的 Discord 授权，直接尝试硬闯控制台首页】 ======
        console.log('📤 尝试直接前往控制台首页（跳过手动登录表单）...');
        await page.goto('https://control.optiklink.net/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        
        // 检查是否仍然停留在登录页，如果是，才去尝试备用的账密登录（双保险）
        if (page.url().includes('/auth/login')) {
            console.log('ℹ️ 未能自动登录，触发备用方案：手动填写控制台账号密码...');
            await page.fill('input[name="username"]', panelUser);
            await page.fill('input[name="password"]', panelPass);
            await page.click('button[type="submit"]');
            
            console.log('⏳ 等待控制台登录跳转...');
            await page.waitForURL(url => !url.toString().includes('/auth/login'), { timeout: 20000 }).catch(() => {
                console.log('⚠️ 账密登录可能被 reCAPTCHA 验证码卡住，尝试强行刷新主控...');
            });
        }

        // 再次强行重定向到集群首页或服务器页面
        await page.goto('https://control.optiklink.net/', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
        console.log(`✅ 当前控制台页面：${page.url()}`);

        await page.waitForTimeout(3000);

        console.log('🔍 查找服务器...');
        const serverInfo = await page.evaluate(() => {
            const card = document.querySelector('a[href*="/server/"]');
            if (!card) return null;
            const href = card.getAttribute('href');
            const id = href.split('/server/')[1]?.split('/')[0]?.trim() || href.replace('/server/', '').trim();
            const nameEl = card.querySelector('p.sc-1ibsw91-5') || card.querySelector('p') || card.querySelector('div');
            const name = nameEl ? nameEl.innerText.trim() : 'OptikLink-Server';
            return { id, name };
        });

        if (!serverInfo) {
            throw new Error(`❌ 未找到服务器卡片，可能登录未成功。当前 URL: ${page.url()}`);
        }
        console.log(`✅ 找到服务器：${serverInfo.name} (${serverInfo.id})`);

        console.log(`🛰️ 正在导航至服务器详情页...`);
        await page.goto(`https://control.optiklink.net/server/${serverInfo.id}`, { waitUntil: 'domcontentloaded' });
        
        console.log('🔍 检查服务器状态...');
        await page.waitForTimeout(5000);

        let statusText = '';
        for (let i = 0; i < 6; i++) {
            statusText = await page.locator('p.sc-168cvuh-1, div[class*="status"], span[class*="status"]').first().innerText().catch(() => '');
            if (!statusText) {
                statusText = await page.evaluate(() => {
                    const el = document.body.innerText;
                    if (el.includes('RUNNING')) return 'RUNNING';
                    if (el.includes('OFFLINE')) return 'OFFLINE';
                    return '';
                });
            }
            const s = statusText.toLowerCase();
            if (s.includes('run') || s.includes('start') || s.includes('off') || s.includes('stop')) break;
            await page.waitForTimeout(4000);
        }

        console.log(`💻 服务器状态：${statusText.trim() || '未知（尝试盲点）'}`);

        const currentStatus = statusText.toLowerCase();
        if (currentStatus.includes('run') || currentStatus.includes('start')) {
            console.log('🎉 保活成功！服务器正在运行');
            await sendTG(`✅ 保活成功！\n💻 服务器状态：🚀 ${statusText.trim() || 'Running'}`, serverInfo.name);
        } else {
            console.log('⚠️ 服务器未处于稳定运行态，尝试点击 Start 激活...');
            await page.click('button:has-text("Start"), button:has-text("启动"), button.bg-green-500').catch(() => {
                return page.click('button');
            });
            console.log('📤 已触发 Start 动作指令，持续监控状态...');

            let started = false;
            for (let i = 0; i < 10; i++) {
                await page.waitForTimeout(5000);
                const s = await page.locator('p.sc-168cvuh-1, div[class*="status"]').first().innerText().catch(() => '');
                if (s.toLowerCase().includes('run') || s.toLowerCase().includes('start')) {
                    started = true;
                    break;
                }
            }

            if (started) {
                console.log('✅ 服务器已成功启动！');
                await sendTG('🔄 Start 启动成功！\n💻 服务器状态：🚀 Running', serverInfo.name);
            } else {
                console.log('ℹ️ 指令已下发（状态未及时刷新），保活流程结束。');
                await sendTG('🔄 Start 指令已下发\n💻 请稍后前往控制台确认状态', serverInfo.name);
            }
        }

    } catch (e) {
        try {
            const screenshotPath = testInfo.outputPath('failure.png');
            await activePage.screenshot({ path: screenshotPath, fullPage: true });
            await testInfo.attach('failure', { path: screenshotPath, contentType: 'image/png' });
            console.log('📸 失败截图已保存');
        } catch {}
        await sendTG(`❌ 脚本异常：${e.message}`);
        throw e;
    } finally {
        await browser.close();
    }
});
