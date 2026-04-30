import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import iconv from "iconv-lite";
import puppeteer from "puppeteer";
import { CITIES, TRANSACTION_TYPES, PROPERTY_TYPES, CITY_DISTRICTS } from "./src/constants";

export async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Simple sequential lock for Puppeteer searches to avoid 429 errors from govt site
  let searchQueue: Promise<any> = Promise.resolve();

  // Puppeteer Proxy Search Endpoint
  app.post("/api/proxy-search", (req, res) => {
    // Track whether the client disconnected before we started processing.
    // React StrictMode sends a duplicate request then immediately closes the first one;
    // this flag lets us skip queued work for aborted requests.
    let clientAborted = false;
    req.on('close', () => {
      if (!res.headersSent) {
        clientAborted = true;
        console.log('[LOCK] Client disconnected before response — skipping queued request.');
      }
    });

    // Add request to the sequential queue
    searchQueue = searchQueue.then(async () => {
      if (clientAborted) return; // skip — client already gave up

      // Add a small cool-down delay between tasks to avoid 429 errors
      await new Promise(r => setTimeout(r, 5000));

      if (clientAborted) return; // skip — client disconnected during the delay

      const { cityCode, district, propertyTypes, transactionType, period, unitPrice, area, age, keyword } = req.body;

      // Resolve qryType and tableId from TRANSACTION_TYPES constant
      const txTypeDef = TRANSACTION_TYPES.find(t => t.code === String(transactionType));
      const qryType  = txTypeDef?.qryType  || 'biz';
      const tableId  = txTypeDef?.tableId  || 'bizList_table';

      // Resolve ptype codes from PROPERTY_TYPES constant
      const ptypeCodes = Array.isArray(propertyTypes) && propertyTypes.length
        ? [...new Set(
            (propertyTypes as string[]).flatMap(name => {
              const def = PROPERTY_TYPES.find(p => p.name === name);
              return def?.ptypeCodes ?? ['1', '2'];
            })
          )].sort().join(',')
        : '1,2';

      // Resolve town code directly from CITY_DISTRICTS constant (no Puppeteer AJAX needed)
      const cityName  = CITIES.find(c => c.code === cityCode)?.name || '';
      const townCode  = (district && district !== '全部')
        ? (CITY_DISTRICTS[cityName]?.find(d => d.name === district)?.code || '')
        : '';

      const startTime = Date.now();
      let browser;
      try {
        console.log(`[LOCK] Starting search for ${cityCode}/${district}...`);
        browser = await puppeteer.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,720']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // --- Optimization: block manifest.json, tracking, and heavy assets to avoid 404s and reduce load ---
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const url = req.url();
          const rt = req.resourceType();
          if (
            url.includes('manifest.json') || 
            url.includes('google-analytics') || 
            url.includes('googletagmanager') ||
            ['image', 'font', 'media'].includes(rt)
          ) {
            req.abort();
          } else {
            req.continue();
          }
        });

        // --- Diagnostic: log page console errors and important XHR traffic ---
        page.on('console', msg => {
          const text = msg.text();
          const lowerText = text.toLowerCase();
          // Filter out noisy errors: manifest, resource loading failures (404), analytics, etc.
          const isNoisy = lowerText.includes('manifest.json') || 
                          lowerText.includes('net::err_failed') || 
                          lowerText.includes('status of 404') || 
                          lowerText.includes('status of 400') ||
                          lowerText.includes('failed to load resource');

          if (msg.type() === 'error' && !isNoisy) {
            console.log(`[PAGE-ERR] ${text}`);
          }
        });
        page.on('request', req => {
          const rt = req.resourceType();
          if (rt === 'xhr' || rt === 'fetch') {
            const pathUrl = req.url().replace('https://lvr.land.moi.gov.tw', '');
            if (pathUrl.includes('QueryPrice')) console.log(`[XHR→] POST ${pathUrl}`);
          }
        });
        page.on('response', res => {
          const rt = res.request().resourceType();
          if ((rt === 'xhr' || rt === 'fetch') && res.url().includes('lvr.land.moi.gov.tw')) {
            const status = res.status();
            if (status >= 400) {
              console.log(`[←XHR] ${status} ${res.url().replace('https://lvr.land.moi.gov.tw', '')}`);
            }
          }
        });

      // QueryPrice response promise — resolved when /SERVICE/QueryPrice/ responds.
      // DataTables shows "無資料" as INITIAL render before the AJAX even fires;
      // we must wait for the actual HTTP response, not just DOM state.
      let resolveQueryPrice!: (result: { status: number; body: string }) => void;
      const queryPriceDonePromise = new Promise<{ status: number; body: string }>(r => { resolveQueryPrice = r; });
      const qpHandler = async (resp: any) => {
        if (resp.url().includes('/SERVICE/QueryPrice/')) {
          const status: number = resp.status();
          console.log(`[QUERY-PRICE] HTTP ${status}`);
          try {
            const body = await resp.text();
            // Log full body (up to 2000 chars) to diagnose format
            console.log('[QUERY-PRICE] Body:', body.substring(0, 2000));
            // Log JSON field names if parseable
            try {
              const parsed = JSON.parse(body);
              const sample = Array.isArray(parsed) ? parsed[0] : (parsed?.data?.[0] || parsed);
              if (sample && typeof sample === 'object') {
                console.log('[QUERY-PRICE] JSON fields:', Object.keys(sample).join(', '));
              }
            } catch { /* not JSON */ }
            resolveQueryPrice({ status, body });
          } catch {
            resolveQueryPrice({ status, body: '(body-read-error)' });
          }
          page.off('response', qpHandler);
        }
      };
      page.on('response', qpHandler);

      // 1. Visit index.jsp to establish same-origin context for localStorage injection.
      //    No form interaction needed — town code is resolved from constants.
      console.log(`Search: city=${cityCode}(${cityName}), district=${district}(${townCode}), qryType=${qryType}, ptype=${ptypeCodes}`);
      await page.goto('https://lvr.land.moi.gov.tw/jsp/index.jsp', { waitUntil: 'domcontentloaded', timeout: 60000 });

      // 2. Build localStorage form-data matching the website's gopage() format.
      //    list.jsp reads this object on load to populate its form and call the price API.
      const formData = {
        qryType,
        city:  cityCode,
        town:  townCode,
        // gopage() collects ptype via checkbox .map().get() → array, e.g. ['3'] or ['1','2']
        // Storing as a plain string causes list.jsp's Array.isArray(ptype) check to fail silently.
        ptype: ptypeCodes.split(','),
        starty: String(period?.startY || '114'),
        startm: String(period?.startM || '1'),
        endy:   String(period?.endY   || '115'),
        endm:   String(period?.endM   || '12'),
        ftype:  '',
        p_build: keyword || '',
        price_s: '', price_e: '',
        unit_price_s: unitPrice?.min != null && unitPrice?.min !== '' ? String(unitPrice.min) : '',
        unit_price_e: unitPrice?.max != null && unitPrice?.max !== '' ? String(unitPrice.max) : '',
        area_s:  area?.min  != null && area?.min  !== '' ? String(area.min)  : '',
        area_e:  area?.max  != null && area?.max  !== '' ? String(area.max)  : '',
        build_s: '', build_e: '',
        // buildyear_s/e expects building completion year in 民國 (ROC year), NOT age in years.
        // Convert: completionYear = currentRocYear − age
        // buildyear_s (lower year bound) = currentYear − maxAge  (older buildings)
        // buildyear_e (upper year bound) = currentYear − minAge  (newer buildings)
        buildyear_s: age?.max != null && age?.max !== ''
          ? String((new Date().getFullYear() - 1911) - parseInt(String(age.max))) : '',
        buildyear_e: age?.min != null && age?.min !== ''
          ? String((new Date().getFullYear() - 1911) - parseInt(String(age.min))) : '',
        doorno: '', pattern: '', community: '', floor: '',
        urban: '', urbantext: '', nurban: '', aa12: '',
        p_purpose: '',
        p_unusual_yn: 'N', p_unusualcode: '',
        QB41: '', show_avg: 'N',
        tmoney_unit: '1',
        pmoney_unit: unitPrice?.unit === '2' ? '2' : '1',  // '1'=萬元/坪, '2'=元/㎡
        unit: area?.unit === '1' ? '1' : '2',              // '1'=㎡, '2'=坪
        rent_type: '', rent_order: '',
      };

      // 3. Inject form-data into localStorage (same-origin context set by index.jsp)
      await page.evaluate((data: object) => {
        localStorage.setItem('form-data', JSON.stringify(data));
      }, formData);
      // Verify injection — log the exact JSON that list.jsp will read
      const storedJson = await page.evaluate(() => localStorage.getItem('form-data'));
      console.log('[DEBUG] Injected form-data:', storedJson);

      // 4. Navigate directly to list.jsp — avoids waitForNavigation + networkidle2 timeout
      console.log(`Navigating to list.jsp (qryType=${qryType}, ptype=${ptypeCodes}, town=${townCode})...`);
      // 用 domcontentloaded 取代 load：load 會等圖片/CSS/iframe 全部完成才 resolve，
      // 目標網站有 slow resource 時會 timeout。DataTables AJAX 完成由後面 waitForFunction 負責偵測。
      await page.goto('https://lvr.land.moi.gov.tw/jsp/list.jsp', { waitUntil: 'domcontentloaded', timeout: 60000 });

      // 5. Wait for the QueryPrice API HTTP response — this is the definitive signal
      //    that the search AJAX has completed. DataTables shows "無資料" as its
      //    initial render BEFORE firing the AJAX, so watching the DOM alone is unreliable.
      console.log('Waiting for /SERVICE/QueryPrice API response (up to )...5s');
      const qpResult = await Promise.race([
        queryPriceDonePromise,
        new Promise<{ status: number; body: string }>(r => setTimeout(() => r({ status: 0, body: '__QP_TIMEOUT__' }), 5000))
      ]);
      if (qpResult.body === '__QP_TIMEOUT__') {
        // QueryPrice was never called — form-data in localStorage did not trigger the search.
        console.log('[ERROR] /SERVICE/QueryPrice was not called. Search was not triggered.');
        console.log('[DEBUG] Injected form-data was:', storedJson);
        return res.status(500).json({ success: false, error: 'Search not triggered by list.jsp — possible form-data format mismatch' });
      }
      if (qpResult.status === 429) {
        console.log('[ERROR] QueryPrice returned 429 Too Many Requests — rate limited by target site.');
        return res.status(429).json({ success: false, error: '查詢次數過多，目標網站 rate limit（429）。請稍後數秒再試。' });
      }
      // Give DataTables 800ms to render the API response into the DOM.
      await new Promise(r => setTimeout(r, 800));

      // 診斷：印出 list.jsp 載入後的實際狀態 + thead 欄位名稱
      const diagState = await page.evaluate((tid: string) => {
        const proc = document.getElementById(`${tid}_processing`);
        const tbody = document.querySelector(`#${tid} tbody`);
        const thead = document.querySelector(`#${tid} thead`);
        const emptyTd = tbody?.querySelector('td.dataTables_empty');
        // Extract column headers from thead
        const theadHeaders = thead
          ? Array.from(thead.querySelectorAll('th')).map(th => th.textContent?.trim() || '')
          : [];
        // Extract first data row as raw text array for column alignment check
        const firstDataRow = (() => {
          const firstTr = tbody?.querySelector('tr:not(.dataTables_empty)');
          if (!firstTr) return [];
          return Array.from(firstTr.querySelectorAll('td')).map(td => td.textContent?.trim() || '');
        })();
        return {
          processingVisible: proc ? window.getComputedStyle(proc).display !== 'none' : null,
          rowCount: tbody?.querySelectorAll('tr').length ?? 0,
          hasEmptyTd: !!emptyTd,
          emptyText: emptyTd?.textContent?.trim() ?? '',
          theadHeaders,
          firstDataRow,
        };
      }, tableId);
      console.log('[DIAG] Table state after AJAX:', JSON.stringify(diagState));
      console.log('[DIAG] Column headers:', diagState.theadHeaders.map((h: string, i: number) => `[${i}]${h}`).join(' | '));
      if (diagState.firstDataRow.length > 0) {
        console.log('[DIAG] First data row:', diagState.firstDataRow.map((v: string, i: number) => `[${i}]${v}`).join(' | '));
      }

      // 最終判斷：④ 無資料
      if (diagState.hasEmptyTd) {
        return res.json({ success: true, source: 'real_data', data: [] });
      }

      // 6. Extract data rows from the results table
      //    Use r.length > 1 (not > 5) to safely handle all property-type column layouts.
      const extractedData: string[][] = await page.evaluate((tid: string) => {
        const tbody = document.querySelector(`#${tid} tbody`);
        if (!tbody) return [];
        return Array.from(tbody.querySelectorAll('tr'))
          .map(r => Array.from(r.querySelectorAll('td')).map(c => c.textContent?.trim() || ''))
          .filter(r => r.length > 1 && r[0] !== '無資料' && r[0] !== '');
      }, tableId);

      console.log(`Extraction complete in ${Date.now() - startTime}ms. Rows: ${extractedData.length}`);

      if (extractedData.length === 0) {
        return res.json({ success: true, source: 'real_data', tableId, data: [] });
      }

      return res.json({ success: true, source: 'real_data', tableId, data: extractedData });

    } catch (error: any) {
      const errMsg = error?.message || String(error);
      console.error("Search Error:", errMsg);
      return res.status(500).json({ success: false, error: errMsg });
    } finally {
      if (browser) {
        await browser.close().catch(e => console.error("Error closing browser:", e));
      }
    }
    }); // end searchQueue.then
  });

  // Remove generateMockCsv and other legacy endpoints to ensure no mock data is used
  app.get("/api/real-estate", (req, res) => {
    res.status(404).json({ error: "此介面已停用，請使用 /api/proxy-search" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Only start if not imported (e.g. running via tsx server.ts)
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.ts')) {
  startServer();
}
