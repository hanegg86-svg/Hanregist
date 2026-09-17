/**
 * PharmaNova - Drug Innovation Checker Logic
 * Model locked to: gemini-3.5-flash-lite
 * Database: IndexedDB
 */

const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const DB_NAME = 'PharmaNovaDB';
const DB_VERSION = 1;

let dbInstance = null;
let currentReport = null;
let activeFilter = 'all';

// --- 1. IndexedDB Initialization & Utilities ---
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('reports')) {
        const reportStore = db.createObjectStore('reports', { keyPath: 'id', autoIncrement: true });
        reportStore.createIndex('drugName', 'drugName', { unique: false });
        reportStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('IndexedDB error:', event.target.error);
      reject(event.target.error);
    };
  });
}

function dbGetSetting(key) {
  return new Promise((resolve, reject) => {
    if (!dbInstance) return resolve(null);
    const tx = dbInstance.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => reject(req.error);
  });
}

function dbSetSetting(key, value) {
  return new Promise((resolve, reject) => {
    if (!dbInstance) return reject(new Error('Database not ready'));
    const tx = dbInstance.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    const req = store.put({ key, value });
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

// User-Defined Custom URL Presets Management in IndexedDB
async function dbGetUrlPresets() {
  const data = await dbGetSetting('url_presets');
  return Array.isArray(data) ? data : [];
}

async function dbSaveUrlPreset(name, url) {
  const list = await dbGetUrlPresets();
  const newPreset = {
    id: 'preset_' + Date.now(),
    name: name.trim(),
    url: url.trim()
  };
  list.push(newPreset);
  await dbSetSetting('url_presets', list);
  return newPreset;
}

async function dbDeleteUrlPreset(id) {
  let list = await dbGetUrlPresets();
  list = list.filter((item) => item.id !== id);
  await dbSetSetting('url_presets', list);
}

function dbSaveReport(report) {
  return new Promise((resolve, reject) => {
    if (!dbInstance) return reject(new Error('Database not ready'));
    const tx = dbInstance.transaction('reports', 'readwrite');
    const store = tx.objectStore('reports');
    const req = store.add(report);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGetAllReports() {
  return new Promise((resolve, reject) => {
    if (!dbInstance) return resolve([]);
    const tx = dbInstance.transaction('reports', 'readonly');
    const store = tx.objectStore('reports');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function dbDeleteReport(id) {
  return new Promise((resolve, reject) => {
    if (!dbInstance) return reject(new Error('Database not ready'));
    const tx = dbInstance.transaction('reports', 'readwrite');
    const store = tx.objectStore('reports');
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

function dbToggleFavorite(id, currentStatus) {
  return new Promise((resolve, reject) => {
    if (!dbInstance) return reject(new Error('Database not ready'));
    const tx = dbInstance.transaction('reports', 'readwrite');
    const store = tx.objectStore('reports');
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const data = getReq.result;
      if (data) {
        data.isFavorite = !currentStatus;
        const putReq = store.put(data);
        putReq.onsuccess = () => resolve(data.isFavorite);
        putReq.onerror = () => reject(putReq.error);
      } else {
        resolve(false);
      }
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

function dbClearAllReports() {
  return new Promise((resolve, reject) => {
    if (!dbInstance) return reject(new Error('Database not ready'));
    const tx = dbInstance.transaction('reports', 'readwrite');
    const store = tx.objectStore('reports');
    const req = store.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

// --- 2. Custom Preset UI Rendering ---
function renderPresetPill(preset) {
  const container = document.getElementById('preset-pills-container');
  const emptyHint = document.getElementById('empty-presets-hint');
  if (emptyHint) emptyHint.style.display = 'none';

  const label = document.createElement('label');
  label.className = 'pill-checkbox preset-pill';
  label.id = `pill_${preset.id}`;

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.value = preset.url;
  input.checked = true;

  const span = document.createElement('span');
  span.textContent = `🔖 ${preset.name} `;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'pill-remove-btn';
  removeBtn.textContent = '✕';
  removeBtn.title = `ลบปุ่ม ${preset.name}`;
  removeBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm(`ต้องการลบปุ่มลัด "${preset.name}" หรือไม่?`)) {
      await dbDeleteUrlPreset(preset.id);
      label.remove();
      const remaining = container.querySelectorAll('.preset-pill');
      if (remaining.length === 0 && emptyHint) {
        emptyHint.style.display = 'inline-block';
      }
    }
  });

  span.appendChild(removeBtn);
  label.appendChild(input);
  label.appendChild(span);
  container.appendChild(label);
}

async function loadSavedPresets() {
  const container = document.getElementById('preset-pills-container');
  const emptyHint = document.getElementById('empty-presets-hint');
  const presets = await dbGetUrlPresets();

  if (presets.length > 0) {
    if (emptyHint) emptyHint.style.display = 'none';
    presets.forEach((p) => {
      renderPresetPill(p);
    });
  } else {
    if (emptyHint) emptyHint.style.display = 'inline-block';
  }
}

// --- 3. Clipboard Copy & Open External Portals (DMSIC / FDA) ---
async function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      console.warn('Clipboard writeText failed:', e);
    }
  }
  try {
    const tempInput = document.createElement('input');
    tempInput.value = text;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
    return true;
  } catch (e) {
    console.warn('Fallback copy failed:', e);
    return false;
  }
}

async function copyAndOpenDmsic() {
  const drugInput = document.getElementById('drug-name-input');
  const drugName = (drugInput.value || (currentReport && currentReport.drugName) || '').trim();
  const targetUrl = (document.getElementById('price-url-input').value || 'https://dmsic.moph.go.th/index/drugsearch/1').trim();

  if (!drugName) {
    alert('กรุณากรอกชื่อยาในช่องค้นหาก่อน');
    drugInput.focus();
    return;
  }

  const copied = await copyTextToClipboard(drugName);
  const msg = copied
    ? `คัดลอกชื่อยา "${drugName}" แล้ว!\nระบบกำลังเปิดเว็บ DMSIC ให้คุณแตะช่องค้นหาแล้วกด "วาง (Paste)" ได้ทันที`
    : `กำลังเปิดเว็บ DMSIC สำหรับค้นหา "${drugName}"`;

  alert(msg);
  window.open(targetUrl, '_blank');
}

async function copyAndOpenFda() {
  const drugInput = document.getElementById('drug-name-input');
  const drugName = (drugInput.value || (currentReport && currentReport.drugName) || '').trim();
  const targetUrl = 'https://pertento.fda.moph.go.th/FDA_SEARCH_DRUG/SEARCH_DRUG/FRM_SEARCH_DRUG.aspx';

  if (!drugName) {
    alert('กรุณากรอกชื่อยาหรือสารสำคัญในช่องค้นหาก่อน');
    drugInput.focus();
    return;
  }

  const copied = await copyTextToClipboard(drugName);
  const msg = copied
    ? `คัดลอกชื่อสารสำคัญ "${drugName}" แล้ว!\nระบบกำลังเปิดหน้าค้นหา อย. ให้คุณแตะช่อง "ชื่อสารสำคัญ" แล้วกด "วาง (Paste)" เพื่อค้นหาทะเบียนตำรับยาได้ทันที`
    : `กำลังเปิดหน้าค้นหา อย. สำหรับสารสำคัญ "${drugName}"`;

  alert(msg);
  window.open(targetUrl, '_blank');
}

// --- 4. Gemini API Integration ---

// Step 1: ดึงขนาดความแรงและรูปแบบยาจากฐานข้อมูล
async function callGeminiFetchStrengths(drugName, priceUrl, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const promptText = `
คุณเป็นผู้เชี่ยวชาญด้านเภสัชวิทยาและระบบฐานข้อมูลราคากลางยาภาครัฐ (DMSIC / อย. / บัญชียาหลักแห่งชาติ)
กรุณาระบุขนาดความแรงและรูปแบบเภสัชภัณฑ์ (Dosage forms & Strengths) ทั้งหมดที่มีการจัดซื้อหรือใช้งานของยาชื่อ: "${drugName}"
โดยเฉพาะที่ปรากฏในฐานข้อมูลราคาจัดซื้อยาภาครัฐของไทย หรือตาม URL นี้: "${priceUrl || 'dmsic.moph.go.th'}"

ส่งผลลัพธ์กลับมาเป็น JSON ล้วนๆ ในรูปแบบ:
\`\`\`json
{
  "strengths": [
    "500 mg powder for injection (vial)",
    "1 g powder for injection (vial)"
  ]
}
\`\`\`
`;

  const requestBody = {
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json'
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API Error (${response.status}): ${errText}`);
  }

  const responseData = await response.json();
  const rawText = responseData.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) throw new Error('ไม่พบข้อมูลขนาดความแรง');

  let parsed = null;
  try {
    parsed = JSON.parse(rawText.trim());
  } catch (e) {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  }

  return parsed && Array.isArray(parsed.strengths) ? parsed.strengths : [];
}

// Step 2: วิเคราะห์นวัตกรรม + สกัดตาราง อย. และ DMSIC
async function callGeminiInnovationCheck(drugName, strength, domains, priceUrl, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  // ดึง HTML ตารางจริงจากเว็บ อย. ผ่าน CORS Proxy
  let rawFdaHtml = "";
  try {
    const fdaTargetUrl = "https://pertento.fda.moph.go.th/FDA_SEARCH_DRUG/SEARCH_DRUG/FRM_SEARCH_DRUG.aspx";
    const proxyUrl = "https://api.allorigins.win/get?url=" + encodeURIComponent(fdaTargetUrl);
    const fdaRes = await fetch(proxyUrl);
    if (fdaRes.ok) {
      const fdaData = await fdaRes.json();
      rawFdaHtml = fdaData.contents || "";
    }
  } catch (e) {
    console.warn("ไม่สามารถดึง HTML ตรงจากเว็บ อย. ได้ จะใช้ฐานข้อมูลของ AI แทน:", e);
  }

  const targetDomainString = domains.join(', ');
  const strengthInstruction = strength
    ? `ขนาดความแรงและรูปแบบที่เจาะจงตรวจสอบ: "${strength}"`
    : `ขนาดความแรง: ประเมินภาพรวมทุกขนาดความแรง`;

  const promptText = `
คุณเป็นผู้เชี่ยวชาญด้านเภสัชวิทยา การขึ้นทะเบียนยา สำนักงานคณะกรรมการอาหารและยา (อย.) และระบบจัดซื้อยาภาครัฐไทย
กรุณาวิเคราะห์นวัตกรรมของยา/สารสำคัญ: "${drugName}"
${strengthInstruction}
โดยเน้นตรวจสอบข้อมูลที่ปรากฏหรือเกี่ยวข้องกับเว็บไซต์/โดเมนต่อไปนี้: [${targetDomainString}]

ข้อมูล HTML ตารางจากเว็บ อย. (ถ้ามี):
${rawFdaHtml ? rawFdaHtml.substring(0, 15000) : "ไม่พบ HTML ตาราง ให้ใช้ข้อมูลทะเบียนที่อนุมัติจริงในไทย"}

กรุณาสกัดหรือประเมินข้อมูล 2 ส่วนสำคัญ:
1. ข้อมูลทะเบียนตำรับยา อย. ประเทศไทย สำหรับสารสำคัญ "${drugName}" (คอลัมน์: no, regNo, tradeNameTh, tradeNameEn, licensee)
2. ข้อมูลราคาอ้างอิงจัดซื้อปกติจาก DMSIC สำหรับขนาดความแรง "${strength || 'มาตรฐาน'}" (คอลัมน์: packSize, company, minPrice, modePrice, medianPrice, avgPrice)

ส่งผลลัพธ์กลับมาเป็นโครงสร้าง JSON ล้วนๆ ในรูปแบบ:
\`\`\`json
{
  "drugName": "${drugName}",
  "selectedStrength": "${strength || 'ทุกขนาดความแรง/ภาพรวม'}",
  "classification": "หมวดหมู่หรือกลุ่มทางเภสัชวิทยา",
  "innovationScore": 9,
  "summary": "สรุปความเป็นนวัตกรรมของยานี้แบบกระชับ 3-4 ประโยค",
  "novelMechanisms": [
    "กลไกการออกฤทธิ์ใหม่จุดที่ 1"
  ],
  "clinicalStatus": "สถานะการทดลองหรือการอนุมัติ",
  "targetDomainFindings": [
    {
      "domain": "ชื่อโดเมน",
      "findings": "ข้อค้นพบสำคัญ"
    }
  ],
  "fdaRegistrations": [
    {
      "no": 1,
      "regNo": "เลขทะเบียน",
      "tradeNameTh": "ชื่อไทย",
      "tradeNameEn": "ชื่ออังกฤษ",
      "licensee": "ผู้รับอนุญาต"
    }
  ],
  "pricing": {
    "hasPriceInfo": true,
    "strength": "${strength || 'ภาพรวม'}",
    "estimatedPrice": "ประมาณการราคาอ้างอิง",
    "priceSource": "DMSIC กระทรวงสาธารณสุข",
    "referenceDocument": "ฐานข้อมูลราคาอ้างอิง DMSIC",
    "dataPeriod": "ปีงบประมาณภาครัฐ",
    "sourceConfidence": "ข้อมูลตรงตามประวัติจัดซื้อ",
    "notes": "หมายเหตุราคา",
    "priceTable": [
      {
        "packSize": "1",
        "company": "ชื่อบริษัท",
        "minPrice": "0",
        "modePrice": "0",
        "medianPrice": "0",
        "avgPrice": "0"
      }
    ]
  }
}
\`\`\`
`;

  const requestBody = {
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json'
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API Error (${response.status}): ${errText}`);
  }

  const responseData = await response.json();
  const rawText = responseData.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) throw new Error('ไม่พบข้อมูลตอบกลับจากโมเดล AI');

  let parsedData = null;
  try {
    parsedData = JSON.parse(rawText.trim());
  } catch (e) {
    const jsonMatch = rawText.match(/```json([\s\S]*?)```/) || rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonStr = jsonMatch[1] ? jsonMatch[1].trim() : jsonMatch[0].trim();
      parsedData = JSON.parse(jsonStr);
    } else {
      throw new Error('โครงสร้างข้อมูล JSON ไม่ถูกต้อง');
    }
  }

  return parsedData;
}

// --- 5. UI Controller & View Switching ---
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const views = document.querySelectorAll('.tab-view');

  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');

      navItems.forEach((i) => i.classList.remove('active'));
      views.forEach((v) => v.classList.remove('active'));

      btn.classList.add('active');
      const targetView = document.getElementById(targetTab);
      if (targetView) targetView.classList.add('active');

      if (targetTab === 'view-history') {
        loadHistoryView();
      }
    });
  });

  document.getElementById('btn-quick-settings').addEventListener('click', () => {
    navItems.forEach((i) => i.classList.remove('active'));
    views.forEach((v) => v.classList.remove('active'));
    document.querySelector('.nav-item[data-tab="view-settings"]').classList.add('active');
    document.getElementById('view-settings').classList.add('active');
  });
}

function renderResult(data) {
  currentReport = {
    ...data,
    timestamp: new Date().toISOString(),
    isFavorite: false
  };

  document.getElementById('result-drug-name').textContent = data.drugName;
  document.getElementById('result-class').textContent = data.classification || 'ไม่ระบุกลุ่ม';
  document.getElementById('result-score').textContent = data.innovationScore || '8';
  document.getElementById('result-summary').textContent = data.summary || '-';
  document.getElementById('result-clinical').textContent = data.clinicalStatus || '-';

  const mechList = document.getElementById('result-mechanisms');
  mechList.innerHTML = '';
  if (Array.isArray(data.novelMechanisms)) {
    data.novelMechanisms.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      mechList.appendChild(li);
    });
  }

  const sourcesDiv = document.getElementById('result-sources');
  sourcesDiv.innerHTML = '';
  if (Array.isArray(data.targetDomainFindings)) {
    data.targetDomainFindings.forEach((src) => {
      const card = document.createElement('div');
      card.className = 'source-item';
      card.innerHTML = `
        <div class="source-domain">${escapeHtml(src.domain)}</div>
        <div>${escapeHtml(src.findings)}</div>
      `;
      sourcesDiv.appendChild(card);
    });
  }

  // เรนเดอร์ตารางทะเบียนตำรับยา อย. ประเทศไทย
  const fdaList = Array.isArray(data.fdaRegistrations) ? data.fdaRegistrations : [];
  document.getElementById('result-fda-ingredient').textContent = `สารสำคัญ: ${escapeHtml(data.drugName)}`;
  document.getElementById('result-fda-count').textContent = `ค้นพบ ${fdaList.length} รายการ`;

  const fdaTbody = document.getElementById('result-fda-tbody');
  fdaTbody.innerHTML = '';

  if (fdaList.length > 0) {
    fdaList.forEach((row, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="text-align: center;">${escapeHtml(String(row.no || idx + 1))}</td>
        <td class="reg-col">${escapeHtml(String(row.regNo || '-'))}</td>
        <td>${escapeHtml(String(row.tradeNameTh || '-'))}</td>
        <td class="company-col">${escapeHtml(String(row.tradeNameEn || '-'))}</td>
        <td>${escapeHtml(String(row.licensee || '-'))}</td>
      `;
      fdaTbody.appendChild(tr);
    });
  } else {
    fdaTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 14px;">ไม่พบรายการขึ้นทะเบียนตำรับยาในประเทศไทยสำหรับสารสำคัญนี้</td></tr>`;
  }

  // เรนเดอร์กล่องราคาและตาราง DMSIC
  const pData = data.pricing || {};
  document.getElementById('result-price-strength').textContent = `ขนาด/รูปแบบ: ${escapeHtml(pData.strength || data.selectedStrength || 'ภาพรวม')}`;
  document.getElementById('result-price-val').textContent = pData.estimatedPrice || 'ประมาณการตามราคากลางภาครัฐ';
  document.getElementById('result-price-src').textContent = pData.priceSource ? `ที่มา: ${pData.priceSource}` : 'DMSIC / ราคากลางยาภาครัฐ';
  document.getElementById('result-price-notes').textContent = pData.notes || 'อ้างอิงจากฐานข้อมูลราคากลางการจัดซื้อยา';

  const docText = pData.referenceDocument || 'ฐานข้อมูลราคาอ้างอิงจัดซื้อปกติ ศูนย์ข้อมูลข่าวสารด้านเวชภัณฑ์ กระทรวงสาธารณสุข (DMSIC)';
  const periodText = pData.dataPeriod || 'รอบข้อมูลปีงบประมาณภาครัฐ';
  const confidenceText = pData.sourceConfidence || 'เทียบเคียงฐานข้อมูลประวัติการจัดซื้อภาครัฐ';

  document.getElementById('result-citation-doc').textContent = docText;
  document.getElementById('result-citation-period').textContent = periodText;
  document.getElementById('result-citation-confidence').textContent = confidenceText;

  const priceTbody = document.getElementById('result-price-tbody');
  priceTbody.innerHTML = '';

  if (Array.isArray(pData.priceTable) && pData.priceTable.length > 0) {
    pData.priceTable.forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(String(row.packSize || '-'))}</td>
        <td class="company-col">${escapeHtml(String(row.company || '-'))}</td>
        <td class="num-col">${escapeHtml(String(row.minPrice || '-'))}</td>
        <td class="num-col">${escapeHtml(String(row.modePrice || '-'))}</td>
        <td class="num-col">${escapeHtml(String(row.medianPrice || '-'))}</td>
        <td class="num-col">${escapeHtml(String(row.avgPrice || '-'))}</td>
      `;
      priceTbody.appendChild(tr);
    });
  } else {
    priceTbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 14px;">ไม่พบรายการแยกบริษัท หรือเป็นยาผูกขาดรายเดียว</td></tr>`;
  }

  document.getElementById('result-container').style.display = 'flex';
  document.getElementById('result-container').scrollIntoView({ behavior: 'smooth' });
}

async function loadHistoryView() {
  const container = document.getElementById('history-list');
  container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted);">กำลังโหลด...</div>';

  try {
    const allReports = await dbGetAllReports();
    container.innerHTML = '';

    const filtered = allReports.filter((item) => {
      if (activeFilter === 'fav') return item.isFavorite === true;
      return true;
    });

    if (filtered.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 30px; color: var(--text-muted);">ไม่มีรายการประวัติใน IndexedDB</div>';
      return;
    }

    filtered.reverse().forEach((rep) => {
      const itemEl = document.createElement('div');
      itemEl.className = 'history-item';
      const dateStr = new Date(rep.timestamp).toLocaleDateString('th-TH', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });

      const strengthTag = rep.selectedStrength ? ` [${rep.selectedStrength}]` : '';

      itemEl.innerHTML = `
        <div>
          <div class="history-name">${escapeHtml(rep.drugName)}${escapeHtml(strengthTag)}</div>
          <div class="history-meta">${escapeHtml(rep.classification || '')} • ${dateStr}</div>
        </div>
        <div class="history-actions">
          <button class="btn-fav" title="รายการโปรด">${rep.isFavorite ? '⭐' : '☆'}</button>
          <button class="btn-del" title="ลบรายการ">🗑️</button>
        </div>
      `;

      itemEl.querySelector('.btn-fav').addEventListener('click', async (e) => {
        e.stopPropagation();
        await dbToggleFavorite(rep.id, rep.isFavorite);
        loadHistoryView();
      });

      itemEl.querySelector('.btn-del').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`ต้องการลบรายการ ${rep.drugName} หรือไม่?`)) {
          await dbDeleteReport(rep.id);
          loadHistoryView();
        }
      });

      itemEl.addEventListener('click', () => {
        renderResult(rep);
        document.querySelector('.nav-item[data-tab="view-search"]').click();
      });

      container.appendChild(itemEl);
    });
  } catch (err) {
    container.innerHTML = `<div style="color: var(--danger); padding: 10px;">เกิดข้อผิดพลาด: ${err.message}</div>`;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    (tag) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// --- 6. Event Listeners & Startup ---
document.addEventListener('DOMContentLoaded', async () => {
  await openDatabase();
  await loadSavedPresets();
  initNavigation();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.warn('Service Worker registration failed:', err);
    });
  }

  const storedKey = await dbGetSetting('gemini_api_key');
  if (storedKey) {
    document.getElementById('api-key-input').value = storedKey;
  }

  document.getElementById('btn-toggle-key').addEventListener('click', () => {
    const keyInput = document.getElementById('api-key-input');
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('btn-save-key').addEventListener('click', async () => {
    const key = document.getElementById('api-key-input').value.trim();
    if (!key) {
      alert('กรุณากรอก API Key');
      return;
    }
    await dbSetSetting('gemini_api_key', key);
    alert('บันทึก API Key ลงใน IndexedDB เรียบร้อยแล้ว');
  });

  document.getElementById('btn-open-dmsic').addEventListener('click', copyAndOpenDmsic);
  document.getElementById('btn-open-dmsic-result').addEventListener('click', copyAndOpenDmsic);
  document.getElementById('btn-open-fda').addEventListener('click', copyAndOpenFda);
  document.getElementById('btn-open-fda-result').addEventListener('click', copyAndOpenFda);

  document.getElementById('btn-save-preset').addEventListener('click', async () => {
    const nameInput = document.getElementById('preset-name-input');
    const urlInput = document.getElementById('preset-url-input');
    const name = nameInput.value.trim();
    const url = urlInput.value.trim();

    if (!name) {
      alert('กรุณาตั้งชื่อปุ่มกด เช่น อย. ทะเบียน, DMSIC ราคากลาง');
      nameInput.focus();
      return;
    }
    if (!url) {
      alert('กรุณาระบุ URL หรือโดเมนที่ต้องการบันทึก');
      urlInput.focus();
      return;
    }

    try {
      const newPreset = await dbSaveUrlPreset(name, url);
      renderPresetPill(newPreset);
      nameInput.value = '';
      urlInput.value = '';
      alert(`บันทึกปุ่มด่วน "${name}" เรียบร้อยแล้ว`);
    } catch (e) {
      alert('เกิดข้อผิดพลาดในการบันทึกปุ่ม: ' + e.message);
    }
  });

  const drugInput = document.getElementById('drug-name-input');
  const clearBtn = document.getElementById('btn-clear-search');
  drugInput.addEventListener('input', () => {
    clearBtn.style.display = drugInput.value ? 'block' : 'none';
  });
  clearBtn.addEventListener('click', () => {
    drugInput.value = '';
    clearBtn.style.display = 'none';
    drugInput.focus();
  });

  // Step 1: ปุ่มดึงขนาดความแรง
  document.getElementById('btn-fetch-strengths').addEventListener('click', async () => {
    const drugName = drugInput.value.trim();
    if (!drugName) {
      alert('กรุณากรอกชื่อยาก่อนเพื่อดึงขนาดความแรง');
      return;
    }

    const apiKey = await dbGetSetting('gemini_api_key');
    if (!apiKey) {
      alert('กรุณาตั้งค่า Gemini API Key ที่แท็บ "ตั้งค่า" ก่อน');
      document.querySelector('.nav-item[data-tab="view-settings"]').click();
      return;
    }

    const priceUrl = document.getElementById('price-url-input').value.trim();
    const btn = document.getElementById('btn-fetch-strengths');
    const btnText = btn.querySelector('.btn-text');
    const btnSpinner = btn.querySelector('.btn-spinner');
    const select = document.getElementById('drug-strength-select');

    btn.disabled = true;
    btnText.textContent = 'กำลังดึงขนาดความแรงจากฐานข้อมูล...';
    btnSpinner.style.display = 'block';

    try {
      const strengths = await callGeminiFetchStrengths(drugName, priceUrl, apiKey);
      select.innerHTML = '<option value="">-- ภาพรวมทุกขนาดความแรง --</option>';

      if (strengths.length > 0) {
        strengths.forEach((st) => {
          const opt = document.createElement('option');
          opt.value = st;
          opt.textContent = st;
          select.appendChild(opt);
        });
        select.selectedIndex = 1;
      } else {
        const opt = document.createElement('option');
        opt.value = 'มาตรฐาน';
        opt.textContent = 'ขนาดมาตรฐานทั่วไป';
        select.appendChild(opt);
      }
    } catch (error) {
      alert(`ดึงขนาดความแรงไม่สำเร็จ: ${error.message}`);
    } finally {
      btn.disabled = false;
      btnText.textContent = '🔍 ดึงขนาดความแรง (Step 1)';
      btnSpinner.style.display = 'none';
    }
  });

  // Step 2: Analyze Button
  document.getElementById('btn-analyze').addEventListener('click', async () => {
    const drugName = drugInput.value.trim();
    if (!drugName) {
      alert('กรุณากรอกชื่อยาที่ต้องการตรวจสอบ');
      return;
    }

    const apiKey = await dbGetSetting('gemini_api_key');
    if (!apiKey) {
      alert('กรุณาตั้งค่า Gemini API Key ที่แท็บ "ตั้งค่า" ก่อนใช้งาน');
      document.querySelector('.nav-item[data-tab="view-settings"]').click();
      return;
    }

    const selectedDomains = [];
    document.querySelectorAll('#domain-pills-container input:checked').forEach((cb) => {
      selectedDomains.push(cb.value);
    });
    document.querySelectorAll('#preset-pills-container input:checked').forEach((cb) => {
      selectedDomains.push(cb.value);
    });

    if (selectedDomains.length === 0) {
      alert('กรุณาเลือกหรือระบุโดเมนเป้าหมายอย่างน้อย 1 แห่ง');
      return;
    }

    const priceUrl = document.getElementById('price-url-input').value.trim();
    const selectedStrength = document.getElementById('drug-strength-select').value;

    const btn = document.getElementById('btn-analyze');
    const btnText = btn.querySelector('.btn-text');
    const btnSpinner = btn.querySelector('.btn-spinner');

    btn.disabled = true;
    btnText.textContent = 'AI กำลังสืบค้นข้อมูล อย. และราคา...';
    btnSpinner.style.display = 'block';

    try {
      const analysisData = await callGeminiInnovationCheck(drugName, selectedStrength, selectedDomains, priceUrl, apiKey);
      renderResult(analysisData);
    } catch (error) {
      alert(`การวิเคราะห์ล้มเหลว: ${error.message}`);
    } finally {
      btn.disabled = false;
      btnText.textContent = 'ตรวจสอบนวัตกรรม ทะเบียน อย. และราคา (Step 2)';
      btnSpinner.style.display = 'none';
    }
  });

  document.getElementById('btn-save-report').addEventListener('click', async () => {
    if (!currentReport) return;
    try {
      await dbSaveReport(currentReport);
      alert('บันทึกผลการตรวจสอบลงใน IndexedDB สำเร็จ');
    } catch (e) {
      alert('เกิดข้อผิดพลาดในการบันทึก: ' + e.message);
    }
  });

  document.getElementById('btn-clear-db').addEventListener('click', async () => {
    if (confirm('คุณแน่ใจหรือไม่ว่าต้องการลบประวัติการค้นหาทั้งหมดใน IndexedDB?')) {
      await dbClearAllReports();
      alert('ลบข้อมูลใน IndexedDB เรียบร้อยแล้ว');
      loadHistoryView();
    }
  });

  document.getElementById('filter-all').addEventListener('click', function () {
    activeFilter = 'all';
    this.classList.add('active');
    document.getElementById('filter-fav').classList.remove('active');
    loadHistoryView();
  });

  document.getElementById('filter-fav').addEventListener('click', function () {
    activeFilter = 'fav';
    this.classList.add('active');
    document.getElementById('filter-all').classList.remove('active');
    loadHistoryView();
  });
});
