// Konfigurasi API (satu origin untuk /analyze dan /weather)
const API_URL = 'https://project-make-ai-agent.onrender.com/analyze';
const API_ORIGIN = API_URL.replace(/\/analyze\/?$/i, '');
const WEATHER_URL = `${API_ORIGIN}/weather`;

const HEALTH_HISTORY_KEY = 'agrimind_health_series';
const MAX_HISTORY = 14;

// Global Variables
let stream = null;
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const modal = document.getElementById('captureModal');
const modalContent = document.getElementById('modalContent');
const imageInput = document.getElementById('imageInput');
const previewImage = document.getElementById('previewImage');

let historicalChartInstance = null;
let productionChartInstance = null;
let chartsInitialized = false;
let lastWeatherBundle = null;
let weatherFetchTimer = null;

// --- Tab Navigation & Mobile Sidebar Logic ---
const navItems = document.querySelectorAll('.nav-item[data-target]');
const pageSections = document.querySelectorAll('.page-section');

const openSidebarBtn = document.getElementById('openSidebarBtn');
const closeSidebarBtn = document.getElementById('closeSidebarBtn');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');

function openSidebar() {
    sidebar.classList.remove('-translate-x-full');
    sidebarOverlay.classList.remove('hidden');
    setTimeout(() => sidebarOverlay.classList.remove('opacity-0'), 10);
}

function closeSidebar() {
    sidebar.classList.add('-translate-x-full');
    sidebarOverlay.classList.add('opacity-0');
    setTimeout(() => sidebarOverlay.classList.add('hidden'), 300);
}

if (openSidebarBtn) openSidebarBtn.addEventListener('click', openSidebar);
if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', closeSidebar);
if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);

function destroyCharts() {
    if (historicalChartInstance) {
        historicalChartInstance.destroy();
        historicalChartInstance = null;
    }
    if (productionChartInstance) {
        productionChartInstance.destroy();
        productionChartInstance = null;
    }
}

function readHealthHistory() {
    try {
        const raw = localStorage.getItem(HEALTH_HISTORY_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.slice(-MAX_HISTORY) : [];
    } catch {
        return [];
    }
}

function appendHealthHistory(healthIndex) {
    const series = readHealthHistory();
    series.push({ t: Date.now(), h: Number(healthIndex) || 0 });
    localStorage.setItem(HEALTH_HISTORY_KEY, JSON.stringify(series.slice(-MAX_HISTORY)));
}

function updateTrendBadge() {
    const el = document.getElementById('trendBadge');
    if (!el) return;
    const s = readHealthHistory();
    if (s.length < 2) {
        el.textContent = 'Butuh ≥2 analisis untuk tren';
        el.className = 'bg-slate-50 text-slate-500 px-3 py-1 rounded-full text-xs font-bold';
        return;
    }
    const a = s[s.length - 2].h;
    const b = s[s.length - 1].h;
    const diff = b - a;
    const pct = a ? Math.round((diff / a) * 100) : diff;
    const sign = diff >= 0 ? '+' : '';
    el.textContent = `${sign}${pct}% vs analisis sebelumnya`;
    el.className =
        diff >= 0
            ? 'bg-green-50 text-green-600 px-3 py-1 rounded-full text-xs font-bold'
            : 'bg-orange-50 text-orange-700 px-3 py-1 rounded-full text-xs font-bold';
}

function initCharts() {
    destroyCharts();
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.color = "#64748B";

    const history = readHealthHistory();
    const ctxHistory = document.getElementById('historicalChart').getContext('2d');
    let labels = [];
    let values = [];
    if (history.length) {
        labels = history.map((p) => {
            const d = new Date(p.t);
            return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        });
        values = history.map((p) => p.h);
    } else {
        labels = ['—'];
        values = [0];
    }

    let gradientHistory = ctxHistory.createLinearGradient(0, 0, 0, 400);
    gradientHistory.addColorStop(0, 'rgba(200, 230, 100, 0.4)');
    gradientHistory.addColorStop(1, 'rgba(200, 230, 100, 0.0)');

    historicalChartInstance = new Chart(ctxHistory, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Skor Kesehatan (%)',
                    data: values,
                    borderColor: '#C8E664',
                    backgroundColor: gradientHistory,
                    borderWidth: 4,
                    tension: 0.4,
                    fill: true,
                    pointBackgroundColor: '#0B2E26',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointRadius: 6,
                    pointHoverRadius: 8,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0B2E26',
                    titleFont: { size: 14, weight: 'bold' },
                    bodyFont: { size: 14 },
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: function (context) {
                            return `Skor: ${context.parsed.y}%`;
                        },
                    },
                },
            },
            scales: {
                y: {
                    beginAtZero: true,
                    min: 0,
                    max: 100,
                    grid: { borderDash: [5, 5], color: '#f1f5f9', drawBorder: false },
                },
                x: { grid: { display: false, drawBorder: false } },
            },
        },
    });

    const blocks = (window.lastAnalysis && window.lastAnalysis.dashboard && window.lastAnalysis.dashboard.field_blocks) || [];
    const ctxProd = document.getElementById('productionChart').getContext('2d');
    let prodLabels = ['—'];
    let prodData = [0];
    if (blocks.length) {
        prodLabels = blocks.map((b) => b.name || 'Blok');
        prodData = blocks.map((b) => Number(b.yield_ton) || 0);
    }

    productionChartInstance = new Chart(ctxProd, {
        type: 'bar',
        data: {
            labels: prodLabels,
            datasets: [
                {
                    label: 'Estimasi hasil (Ton)',
                    data: prodData,
                    backgroundColor: '#0B2E26',
                    borderRadius: 8,
                    barPercentage: 0.6,
                    categoryPercentage: 0.8,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { usePointStyle: true, padding: 20, font: { weight: 'bold' } },
                },
            },
            scales: {
                y: { beginAtZero: true, grid: { borderDash: [5, 5], color: '#f1f5f9', drawBorder: false } },
                x: { grid: { display: false, drawBorder: false } },
            },
        },
    });

    updateTrendBadge();
}

navItems.forEach((item) => {
    item.addEventListener('click', (e) => {
        e.preventDefault();

        navItems.forEach((nav) => nav.classList.remove('active'));
        item.classList.add('active');

        pageSections.forEach((sec) => sec.classList.remove('active'));

        const targetId = item.getAttribute('data-target');
        document.getElementById(targetId).classList.add('active');

        if (window.innerWidth < 768) {
            closeSidebar();
        }

        if (targetId === 'analitik') {
            setTimeout(() => {
                initCharts();
                chartsInitialized = true;
            }, 100);
        }
    });
});

// --- Cuaca & dasbor dari API ---
function setAdvisoryCardStyle(mode) {
    const card = document.getElementById('advisoryCard');
    if (!card) return;
    card.className =
        mode === 'rain'
            ? 'bg-red-50 border-l-4 border-red-500 p-4 rounded-2xl mb-6 md:mb-8 flex items-start shadow-sm'
            : 'bg-amber-50 border-l-4 border-amber-500 p-4 rounded-2xl mb-6 md:mb-8 flex items-start shadow-sm';
    const iconWrap = document.getElementById('advisoryIconWrap');
    if (iconWrap) {
        iconWrap.className = mode === 'rain' ? 'text-red-500 mr-3 mt-0.5 shrink-0' : 'text-amber-600 mr-3 mt-0.5 shrink-0';
    }
    const titleEl = document.getElementById('advisoryTitle');
    const bodyEl = document.getElementById('advisoryBody');
    if (titleEl)
        titleEl.className =
            mode === 'rain'
                ? 'text-red-800 font-bold text-sm md:text-base'
                : 'text-amber-900 font-bold text-sm md:text-base';
    if (bodyEl)
        bodyEl.className =
            mode === 'rain' ? 'text-red-600 text-xs md:text-sm mt-1' : 'text-amber-800 text-xs md:text-sm mt-1';
}

function riskFromHumidity(h) {
    if (h == null || Number.isNaN(h)) return { text: 'Risiko: —', tone: 'slate' };
    if (h >= 85) return { text: 'Risiko kelembapan tinggi', tone: 'red' };
    if (h >= 70) return { text: 'Risiko sedang', tone: 'orange' };
    return { text: 'Risiko relatif rendah', tone: 'green' };
}

function applyRiskBadge(riskText, tone) {
    const wrap = document.getElementById('riskBadge');
    const txt = document.getElementById('riskBadgeText');
    if (!wrap || !txt) return;
    txt.textContent = riskText;
    wrap.className =
        tone === 'red'
            ? 'bg-red-100 text-red-800 px-3 py-1.5 rounded-full text-xs font-bold inline-flex items-center shadow-sm whitespace-nowrap'
            : tone === 'orange'
              ? 'bg-orange-100 text-orange-700 px-3 py-1.5 rounded-full text-xs font-bold inline-flex items-center shadow-sm whitespace-nowrap'
              : tone === 'green'
                ? 'bg-green-100 text-green-800 px-3 py-1.5 rounded-full text-xs font-bold inline-flex items-center shadow-sm whitespace-nowrap'
                : 'bg-slate-100 text-slate-600 px-3 py-1.5 rounded-full text-xs font-bold inline-flex items-center shadow-sm whitespace-nowrap';
    const dot = wrap.querySelector('span.w-2');
    if (dot) {
        dot.className =
            tone === 'red'
                ? 'w-2 h-2 rounded-full bg-red-500 mr-1.5 animate-pulse'
                : tone === 'orange'
                  ? 'w-2 h-2 rounded-full bg-orange-500 mr-1.5 animate-pulse'
                  : tone === 'green'
                    ? 'w-2 h-2 rounded-full bg-green-600 mr-1.5'
                    : 'w-2 h-2 rounded-full bg-slate-400 mr-1.5';
    }
}

async function fetchWeatherBundle() {
    const location = document.getElementById('locationInput')?.value?.trim() || 'Brebes, Indonesia';
    try {
        const res = await fetch(`${WEATHER_URL}?location=${encodeURIComponent(location)}`);
        if (!res.ok) throw new Error(await res.text());
        lastWeatherBundle = await res.json();
        applyWeatherBundleToUI(lastWeatherBundle);
    } catch (e) {
        console.error(e);
        const title = document.getElementById('advisoryTitle');
        const body = document.getElementById('advisoryBody');
        if (title) title.textContent = 'Cuaca tidak tersedia';
        if (body) body.textContent = 'Periksa WEATHER_API_KEY di server atau coba lokasi lain.';
        const sub = document.getElementById('weatherSublineText');
        if (sub) sub.textContent = 'Gagal memuat cuaca';
        applyRiskBadge('Risiko: —', 'slate');
    }
}

function applyWeatherBundleToUI(bundle) {
    if (!bundle || !bundle.current) return;
    const c = bundle.current;
    const tempEl = document.getElementById('tempDisplay');
    if (tempEl) {
        tempEl.innerHTML = `${Math.round(c.temp_c)}°<span class="text-2xl text-gray-400">C</span>`;
    }
    const sub = document.getElementById('weatherSublineText');
    if (sub) {
        sub.textContent = `${c.condition_text} · Kelembapan ${c.humidity}%`;
    }
    const adv = bundle.advisory || {};
    const title = document.getElementById('advisoryTitle');
    const body = document.getElementById('advisoryBody');
    if (title) title.textContent = adv.title || 'Kondisi cuaca';
    if (body) body.textContent = adv.body || '';
    const rainChance = bundle.forecast_tomorrow && bundle.forecast_tomorrow.daily_chance_of_rain;
    setAdvisoryCardStyle(rainChance != null && rainChance >= 50 ? 'rain' : 'default');

    const tf = document.getElementById('tomorrowForecast');
    if (tf && bundle.forecast_tomorrow) {
        const t = bundle.forecast_tomorrow;
        tf.textContent = t.condition_text || '—';
    }
    const tb = document.getElementById('tomorrowBadge');
    if (tb) {
        if (rainChance != null && rainChance >= 50) {
            tb.textContent = 'Tinjau pupuk & drainase';
        } else {
            tb.textContent = 'Ikuti saran lokal';
        }
    }
    const r = riskFromHumidity(c.humidity);
    applyRiskBadge(r.text, r.tone);
}

function scheduleWeatherRefresh() {
    if (weatherFetchTimer) clearTimeout(weatherFetchTimer);
    weatherFetchTimer = setTimeout(fetchWeatherBundle, 500);
}

// --- Modal & Kamera ---
function openCaptureModal() {
    modal.classList.remove('hidden');
    void modal.offsetWidth;
    modal.classList.add('modal-overlay-show');
    modalContent.classList.add('modal-content-show');
}

function closeCaptureModal() {
    modalContent.classList.remove('modal-content-show');
    modal.classList.remove('modal-overlay-show');
    setTimeout(() => {
        modal.classList.add('hidden');
        stopCamera();
    }, 300);
}

async function startCamera() {
    document.getElementById('cameraContainer').classList.remove('hidden');
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
        });
        video.srcObject = stream;
    } catch (err) {
        alert('Akses kamera ditolak atau tidak tersedia.');
    }
}

function stopCamera() {
    if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        document.getElementById('cameraContainer').classList.add('hidden');
    }
}

function takeSnapshot() {
    const context = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
        (blob) => {
            const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' });
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            imageInput.files = dataTransfer.files;

            previewImage.src = URL.createObjectURL(blob);
            closeCaptureModal();
        },
        'image/jpeg'
    );
}

function setHealthScore(score) {
    const circle = document.getElementById('healthCircle');
    const scoreText = document.getElementById('healthScoreCircle');
    const s = Math.max(0, Math.min(100, Number(score) || 0));

    circle.setAttribute('stroke-dasharray', `${s}, 100`);

    let current = 0;
    const interval = setInterval(() => {
        if (current >= s) {
            clearInterval(interval);
            scoreText.innerText = s;
        } else {
            current++;
            scoreText.innerText = current;
        }
    }, 15);

    circle.classList.remove('text-slate-200', 'text-[#C8E664]', 'text-orange-500', 'text-red-500');
    if (s >= 80) {
        circle.classList.add('text-[#C8E664]');
        scoreText.classList.replace('text-slate-400', 'text-[#0B2E26]');
    } else if (s >= 50) {
        circle.classList.add('text-orange-500');
        scoreText.classList.replace('text-slate-400', 'text-orange-600');
    } else {
        circle.classList.add('text-red-500');
        scoreText.classList.replace('text-slate-400', 'text-red-600');
    }
}

function splitInferenceLabel(raw) {
    if (!raw || typeof raw !== 'string') return { main: '—', badge: '—' };
    const m = raw.match(/\(([^)]+)\)\s*$/);
    if (m) {
        return { main: raw.replace(/\s*\([^)]+\)\s*$/, '').trim() || '—', badge: m[1].trim() };
    }
    return { main: raw.trim(), badge: 'AI' };
}

function formatIdr(n) {
    const x = Number(n);
    if (!Number.isFinite(x) || x <= 0) return '—';
    return (
        'Rp ' +
        x.toLocaleString('id-ID', {
            maximumFractionDigits: 0,
        })
    );
}

function applyEnvironmentalFromAnalysis(data) {
    const env = data.environmental_inference || {};
    const ph = splitInferenceLabel(env.ph_level);
    const mo = splitInferenceLabel(env.soil_moisture);
    const phEl = document.getElementById('envPh');
    const phBd = document.getElementById('envPhBadge');
    const mEl = document.getElementById('envMoisture');
    const mBd = document.getElementById('envMoistureBadge');
    const note = document.getElementById('envNote');
    if (phEl) phEl.textContent = ph.main;
    if (phBd) phBd.textContent = ph.badge;
    if (mEl) mEl.textContent = mo.main;
    if (mBd) mBd.textContent = mo.badge;
    const dash = data.dashboard || {};
    if (note) note.textContent = dash.env_note || data.risk_assessment || 'Inferensi dari model AI berdasarkan foto dan cuaca.';
}

function renderBlocksTable(blocks) {
    const tbody = document.getElementById('blocksTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!blocks || !blocks.length) {
        tbody.innerHTML =
            '<tr><td colspan="5" class="py-8 px-4 text-center text-slate-500 font-medium">Tidak ada data blok di respons API.</td></tr>';
        return;
    }
    const colors = ['bg-green-500', 'bg-blue-500', 'bg-orange-500', 'bg-purple-500', 'bg-teal-500'];
    blocks.forEach((b, i) => {
        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-50 hover:bg-slate-50 transition';
        const dot = colors[i % colors.length];
        tr.innerHTML = `
            <td class="py-4 md:py-5 px-2 md:px-4 text-[#0B2E26] flex items-center gap-2 md:gap-3">
                <div class="w-2 h-2 md:w-3 md:h-3 rounded-full ${dot} shrink-0"></div>
                <span class="truncate">${escapeHtml(b.name || '—')}</span>
            </td>
            <td class="py-4 md:py-5 px-2 md:px-4 text-slate-600">${escapeHtml(b.variety || '—')}</td>
            <td class="py-4 md:py-5 px-2 md:px-4 text-slate-600">${b.area_ha != null ? Number(b.area_ha).toFixed(1) + ' Ha' : '—'}</td>
            <td class="py-4 md:py-5 px-2 md:px-4 text-[#0B2E26]">${b.yield_ton != null ? Number(b.yield_ton).toFixed(1) + ' Ton' : '—'}</td>
            <td class="py-4 md:py-5 px-2 md:px-4"><span class="bg-slate-100 text-slate-800 px-2 md:px-3 py-1 md:py-1.5 rounded-lg text-xs whitespace-nowrap">${escapeHtml(b.growth_status || '—')}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function renderDailyTasks(tasks) {
    const host = document.getElementById('dailyTasksList');
    if (!host) return;
    host.innerHTML = '';
    if (!tasks || !tasks.length) {
        host.innerHTML =
            '<p class="text-sm text-slate-500 py-4 text-center">Tidak ada tugas di respons API.</p>';
        return;
    }
    tasks.forEach((task, idx) => {
        const prio = (task.priority || 'rutin').toLowerCase();
        const done = !!task.done;
        const border =
            prio === 'kritis' && !done
                ? 'border-red-100 bg-red-50/30 hover:bg-red-50/60'
                : done || prio === 'selesai'
                  ? 'border-slate-100 bg-slate-50 opacity-60'
                  : 'border-slate-100 hover:border-slate-300 hover:shadow-md';
        const badge =
            prio === 'kritis' && !done
                ? 'bg-red-100 text-red-700 border border-red-200'
                : done || prio === 'selesai'
                  ? 'bg-slate-200 text-slate-600'
                  : 'bg-blue-50 text-blue-600 border border-blue-100';
        const badgeText = done || prio === 'selesai' ? 'Selesai' : prio === 'kritis' ? 'Kritis' : 'Rutin';
        const label = document.createElement('label');
        label.className = `flex items-start gap-3 md:gap-4 p-4 md:p-5 rounded-2xl border ${border} cursor-pointer transition group`;
        label.innerHTML = `
            <div class="relative flex items-center justify-center mt-1 shrink-0">
                <input type="checkbox" data-task-idx="${idx}" class="task-cb peer w-5 h-5 md:w-6 md:h-6 rounded-lg border-2 ${
                    prio === 'kritis' ? 'border-red-300' : 'border-slate-300'
                } cursor-pointer appearance-none checked:bg-[#0B2E26] checked:border-[#0B2E26]" ${done ? 'checked' : ''}>
                <svg class="absolute w-3 h-3 md:w-4 md:h-4 text-[#C8E664] opacity-0 peer-checked:opacity-100 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>
            </div>
            <div class="flex-1 min-w-0">
                <p class="font-bold text-[#0B2E26] text-sm md:text-lg pr-2 task-title">${escapeHtml(task.title || '—')}</p>
                <p class="text-xs md:text-sm text-slate-600 mt-1 font-medium task-detail">${escapeHtml(task.detail || '')}</p>
            </div>
            <span class="shrink-0 px-2 py-1 md:px-3 md:py-1 rounded-lg text-[10px] md:text-xs font-bold shadow-sm ${badge}">${badgeText}</span>
        `;
        host.appendChild(label);
    });
}

function applyDashboardFromAnalysis(data) {
    const d = data.dashboard || {};
    if (d.advisory_title && d.advisory_body) {
        const title = document.getElementById('advisoryTitle');
        const body = document.getElementById('advisoryBody');
        if (title) title.textContent = d.advisory_title;
        if (body) body.textContent = d.advisory_body;
        const urgent = /peringatan|bahaya|ekstrem|parah|tinggi|kritis|hujan\s+lebat|waspada/i.test(
            String(d.advisory_title) + ' ' + String(d.advisory_body)
        );
        setAdvisoryCardStyle(urgent ? 'rain' : 'default');
    }

    if (data.risk_assessment) {
        const short = data.risk_assessment.length > 80 ? data.risk_assessment.slice(0, 77) + '…' : data.risk_assessment;
        applyRiskBadge(short, 'orange');
    }

    const hs = d.harvest_summary || {};
    const yt = document.getElementById('yieldTotal');
    if (yt) yt.textContent = hs.total_yield_ton != null ? Number(hs.total_yield_ton).toFixed(1) : '—';
    const yab = document.getElementById('yieldAreaBadge');
    if (yab) yab.textContent = hs.total_area_ha != null ? `Luas: ${Number(hs.total_area_ha).toFixed(1)} Ha` : 'Luas: —';
    const yac = document.getElementById('yieldAccuracy');
    if (yac) yac.textContent = hs.accuracy_note || 'Estimasi dari analisis AI';

    const m = d.market_snapshot || {};
    const ml = document.getElementById('marketLocation');
    if (ml) ml.textContent = m.location_label || '—';
    const mp = document.getElementById('marketPrice');
    if (mp) mp.textContent = formatIdr(m.price_per_kg_idr);
    const mc = document.getElementById('marketChange');
    if (mc) mc.textContent = m.change_note || '—';

    renderBlocksTable(d.field_blocks);

    const sch = d.schedule || {};
    const jbt = document.getElementById('jadwalBlockTitle');
    if (jbt) jbt.textContent = sch.focus_block ? `Siklus · ${sch.focus_block}` : 'Jadwal & siklus';
    const pa = document.getElementById('plantAge');
    if (pa) pa.textContent = sch.plant_age_days != null ? String(sch.plant_age_days) : '—';
    const total = sch.cycle_total_days != null ? Number(sch.cycle_total_days) : 60;
    const age = sch.plant_age_days != null ? Number(sch.plant_age_days) : 0;
    const pct = total > 0 ? Math.min(100, Math.round((age / total) * 100)) : 0;
    const bar = document.getElementById('cycleProgressBar');
    if (bar) bar.style.width = `${pct}%`;
    const cel = document.getElementById('cycleEndLabel');
    if (cel) cel.textContent = `Panen (${total} HST)`;

    const ht = document.getElementById('harvestTarget');
    if (ht) {
        if (sch.harvest_target_iso) {
            const dt = new Date(sch.harvest_target_iso);
            ht.textContent = Number.isNaN(dt.getTime()) ? sch.harvest_target_iso : dt.toLocaleDateString('id-ID', { dateStyle: 'medium' });
        } else ht.textContent = '—';
    }
    const dth = document.getElementById('daysToHarvest');
    let daysLeft = sch.days_to_harvest != null ? Number(sch.days_to_harvest) : null;
    if ((daysLeft == null || Number.isNaN(daysLeft)) && sch.harvest_target_iso) {
        const dt = new Date(String(sch.harvest_target_iso).trim() + 'T12:00:00');
        if (!Number.isNaN(dt.getTime())) {
            daysLeft = Math.max(0, Math.ceil((dt.getTime() - Date.now()) / 86400000));
        }
    }
    if (dth) dth.textContent = daysLeft != null && !Number.isNaN(daysLeft) ? String(daysLeft) : '—';

    const ir = document.getElementById('irrigationTime');
    if (ir) ir.textContent = sch.irrigation_suggestion || '—';
    const irh = document.getElementById('irrigationHint');
    if (irh) irh.textContent = sch.fertilizer_hint || 'Saran agronomi dari AI';

    const tf = document.getElementById('tomorrowForecast');
    if (tf && sch.tomorrow_condition) tf.textContent = sch.tomorrow_condition;
    const tb = document.getElementById('tomorrowBadge');
    if (tb && sch.fertilizer_hint) {
        const hint = sch.fertilizer_hint;
        tb.textContent = hint.length > 40 ? hint.slice(0, 37) + '…' : hint;
    }

    renderDailyTasks(d.daily_tasks);
}

function applyWeatherContextToHeader(data) {
    const w = data.weather_context || {};
    if (w.temp != null && w.temp !== 'N/A') {
        const tempEl = document.getElementById('tempDisplay');
        if (tempEl) {
            const t = typeof w.temp === 'number' ? w.temp : parseFloat(w.temp);
            if (!Number.isNaN(t)) {
                tempEl.innerHTML = `${Math.round(t)}°<span class="text-2xl text-gray-400">C</span>`;
            }
        }
    }
    if (w.humidity != null && w.humidity !== 'N/A') {
        const sub = document.getElementById('weatherSublineText');
        if (sub && w.condition) {
            sub.textContent = `${w.condition} · Kelembapan ${w.humidity}%`;
        }
    }
}

async function uploadAndAnalyze() {
    const location = document.getElementById('locationInput').value;
    const loading = document.getElementById('loading');
    const diagnosisLabel = document.getElementById('diagnosisLabel');
    const actionList = document.getElementById('actionPlan');

    if (!imageInput.files[0]) {
        alert('Pilih atau ambil foto daun terlebih dahulu. Analisis memakai API dan memerlukan gambar.');
        return;
    }

    const formData = new FormData();
    formData.append('image', imageInput.files[0]);
    formData.append('location', location);

    loading.classList.remove('hidden');
    diagnosisLabel.innerText = 'Mengirim ke Cloud...';

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText || 'Network response was not ok');
        }

        const data = await response.json();

        window.lastAnalysis = data;

        diagnosisLabel.innerText = data.primary_diagnosis || '—';
        diagnosisLabel.className = 'font-bold text-base md:text-lg text-[#0B2E26] truncate';
        setHealthScore(data.health_index != null ? data.health_index : 0);

        actionList.innerHTML = '';
        const plans = Array.isArray(data.action_plan) ? data.action_plan : [];
        plans.forEach((item) => {
            const li = document.createElement('li');
            li.className = 'flex items-start gap-2 text-slate-700 font-semibold';
            li.innerHTML = `<svg class="w-4 h-4 text-[#C8E664] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> <span>${escapeHtml(String(item))}</span>`;
            actionList.appendChild(li);
        });

        appendHealthHistory(data.health_index);
        applyWeatherContextToHeader(data);
        applyEnvironmentalFromAnalysis(data);
        applyDashboardFromAnalysis(data);

        if (chartsInitialized) {
            initCharts();
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Gagal terhubung ke API analisis. Periksa jaringan atau server di: ' + API_URL);
        diagnosisLabel.innerText = 'Gagal memuat';
        diagnosisLabel.classList.add('text-red-600');
    } finally {
        loading.classList.add('hidden');
    }
}

// --- Event Listeners ---
document.getElementById('analyzeBtn').addEventListener('click', uploadAndAnalyze);
document.getElementById('galleryBtn').addEventListener('click', () => imageInput.click());
document.getElementById('cameraBtn').addEventListener('click', startCamera);
document.getElementById('snapBtn').addEventListener('click', takeSnapshot);
document.getElementById('closeModalBtn').addEventListener('click', closeCaptureModal);

modal.addEventListener('click', (e) => {
    if (e.target === modal) closeCaptureModal();
});

imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        previewImage.src = URL.createObjectURL(file);
        closeCaptureModal();
    }
});

const locInput = document.getElementById('locationInput');
if (locInput) {
    locInput.addEventListener('input', scheduleWeatherRefresh);
    locInput.addEventListener('change', scheduleWeatherRefresh);
}

document.addEventListener('DOMContentLoaded', () => {
    fetchWeatherBundle();
});
