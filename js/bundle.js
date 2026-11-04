/**
 * Единый автономный бандл для работы как через http://, так и напрямую через file:///
 * Обновленная версия: убраны нагромождения, улучшена читаемость, плавные вкладки без лишних полосок.
 */
(function() {
    'use strict';

    /* ==========================================================================
       1. РЕЕСТР МЕТАЛЛОВ И API
       ========================================================================== */

    const METALS_DEF = [
        { Id: 0, Symbol: 'Au', Assay: 'Au 999.9', Name: 'Золото', NameEng: 'Gold', NameBel: 'Золата', Color: '#b45309', BgSubtle: 'rgba(180, 83, 9, 0.04)' },
        { Id: 1, Symbol: 'Ag', Assay: 'Ag 999.0', Name: 'Серебро', NameEng: 'Silver', NameBel: 'Серабро', Color: '#475569', BgSubtle: 'rgba(71, 85, 105, 0.04)' },
        { Id: 2, Symbol: 'Pt', Assay: 'Pt 999.5', Name: 'Платина', NameEng: 'Platinum', NameBel: 'Плаціна', Color: '#2563eb', BgSubtle: 'rgba(37, 99, 235, 0.04)' },
        { Id: 3, Symbol: 'Pd', Assay: 'Pd 999.8', Name: 'Палладий', NameEng: 'Palladium', NameBel: 'Паладый', Color: '#0d9488', BgSubtle: 'rgba(13, 148, 136, 0.04)' }
    ];

    const API_BASE = 'https://api.nbrb.by';
    const memoryCache = new Map();

    const FONT_MONO = 'ui-monospace, "JetBrains Mono", "Geist Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    const FONT_UI = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

    function formatDateISO(date) {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function formatDateRU(date) {
        if (!date) return '—';
        const d = new Date(date);
        return d.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }

    async function fetchMetalsList() {
        const cacheKey = 'metals_list';
        if (memoryCache.has(cacheKey)) {
            return memoryCache.get(cacheKey);
        }

        try {
            const res = await fetch(`${API_BASE}/metals`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const metals = await res.json();

            const enriched = metals.map(m => {
                const def = METALS_DEF.find(d => d.Id === m.Id) || METALS_DEF[0];
                return {
                    ...m,
                    Symbol: def.Symbol,
                    Assay: def.Assay,
                    Color: def.Color,
                    BgSubtle: def.BgSubtle
                };
            });

            memoryCache.set(cacheKey, enriched);
            return enriched;
        } catch (err) {
            console.warn('Используем встроенный реестр металлов:', err);
            return METALS_DEF;
        }
    }

    async function fetchLatestPrices() {
        const today = new Date();
        const dateStr = formatDateISO(today);
        const cacheKey = `latest_prices_${dateStr}`;

        if (memoryCache.has(cacheKey)) {
            return memoryCache.get(cacheKey);
        }

        try {
            const res = await fetch(`${API_BASE}/v2/bankingots/prices?ondate=${dateStr}`, {
                headers: { 'Accept': 'application/json' }
            });

            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    memoryCache.set(cacheKey, data);
                    return data;
                }
            }
        } catch (err) {
            console.warn('Не удалось загрузить цены через /v2/bankingots/prices:', err);
        }

        const past = new Date();
        past.setDate(past.getDate() - 7);
        const recent = await fetchPricesRange('all', formatDateISO(past), dateStr);
        
        const latestMap = new Map();
        for (const item of recent) {
            const existing = latestMap.get(item.MetalId);
            if (!existing || new Date(item.Date) > new Date(existing.Date)) {
                latestMap.set(item.MetalId, item);
            }
        }
        return Array.from(latestMap.values());
    }

    function splitDateRange(startDateStr, endDateStr, maxChunkDays = 360) {
        const start = new Date(startDateStr);
        const end = new Date(endDateStr);
        const chunks = [];

        if (start > end) {
            return [{ start: endDateStr, end: startDateStr }];
        }

        let currentStart = new Date(start);

        while (currentStart <= end) {
            let currentEnd = new Date(currentStart);
            currentEnd.setDate(currentEnd.getDate() + maxChunkDays);
            if (currentEnd > end) {
                currentEnd = new Date(end);
            }

            chunks.push({
                start: formatDateISO(currentStart),
                end: formatDateISO(currentEnd)
            });

            currentStart = new Date(currentEnd);
            currentStart.setDate(currentStart.getDate() + 1);
        }

        return chunks;
    }

    async function fetchPricesRange(metalId, startDateStr, endDateStr, onProgress = null) {
        const chunks = splitDateRange(startDateStr, endDateStr);
        const cacheKey = `prices_${metalId}_${startDateStr}_${endDateStr}`;

        if (memoryCache.has(cacheKey)) {
            return memoryCache.get(cacheKey);
        }

        let completed = 0;
        const fetchChunk = async (chunk) => {
            const url = (metalId === 'all')
                ? `${API_BASE}/bankingots/prices?startDate=${chunk.start}&endDate=${chunk.end}`
                : `${API_BASE}/bankingots/prices/${metalId}?startDate=${chunk.start}&endDate=${chunk.end}`;

            try {
                const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
                if (!res.ok) {
                    console.error(`Ошибка при запросе ${chunk.start}..${chunk.end}: HTTP ${res.status}`);
                    return [];
                }
                const data = await res.json();
                completed++;
                if (onProgress) onProgress(completed, chunks.length);
                return Array.isArray(data) ? data : [];
            } catch (e) {
                console.error(`Сетевой сбой при загрузке ${chunk.start}..${chunk.end}:`, e);
                completed++;
                if (onProgress) onProgress(completed, chunks.length);
                return [];
            }
        };

        const results = [];
        const batchSize = 3;
        for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch.map(fetchChunk));
            for (const r of batchResults) {
                results.push(...r);
            }
        }

        const uniqueMap = new Map();
        for (const item of results) {
            const key = `${item.MetalId}_${item.Date.slice(0, 10)}`;
            if (!uniqueMap.has(key)) {
                uniqueMap.set(key, item);
            }
        }

        const merged = Array.from(uniqueMap.values()).sort((a, b) => {
            return new Date(a.Date) - new Date(b.Date);
        });

        if (merged.length > 0) {
            memoryCache.set(cacheKey, merged);
        }

        return merged;
    }

    function calculateStats(priceRecords) {
        if (!priceRecords || priceRecords.length === 0) {
            return null;
        }

        const first = priceRecords[0];
        const last = priceRecords[priceRecords.length - 1];
        
        let minItem = priceRecords[0];
        let maxItem = priceRecords[0];
        let sum = 0;

        for (const item of priceRecords) {
            if (item.Value < minItem.Value) minItem = item;
            if (item.Value > maxItem.Value) maxItem = item;
            sum += item.Value;
        }

        const avg = sum / priceRecords.length;
        const changeAbs = last.Value - first.Value;
        const changePercent = first.Value !== 0 ? (changeAbs / first.Value) * 100 : 0;

        return {
            firstDate: first.Date,
            lastDate: last.Date,
            currentPrice: last.Value,
            firstPrice: first.Value,
            changeAbs,
            changePercent,
            minPrice: minItem.Value,
            minDate: minItem.Date,
            maxPrice: maxItem.Value,
            maxDate: maxItem.Date,
            avgPrice: avg,
            totalPoints: priceRecords.length
        };
    }

    /* ==========================================================================
       2. МОДУЛЬ ГРАФИКА
       ========================================================================== */

    let chartInstance = null;

    function renderMetalChart(canvas, rawData, selectedMetalId, options = {}) {
        if (!canvas) return null;
        const { showPoints = false, normalizePercent = false } = options;

        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }

        if (!rawData || rawData.length === 0) {
            drawEmptyState(canvas);
            return null;
        }

        const dateSet = new Set();
        rawData.forEach(item => dateSet.add(item.Date.slice(0, 10)));
        const sortedDates = Array.from(dateSet).sort();

        const datasets = [];

        if (selectedMetalId === 'all') {
            METALS_DEF.forEach(meta => {
                const metalData = rawData.filter(d => d.MetalId === meta.Id);
                if (metalData.length === 0) return;

                const priceMap = new Map();
                metalData.forEach(d => priceMap.set(d.Date.slice(0, 10), d.Value));

                const firstAvailablePrice = metalData[0]?.Value || 1;

                const points = sortedDates.map(dateKey => {
                    const val = priceMap.get(dateKey);
                    if (val === undefined) return null;
                    if (normalizePercent) {
                        const pct = ((val - firstAvailablePrice) / firstAvailablePrice) * 100;
                        return Number(pct.toFixed(2));
                    }
                    return val;
                });

                datasets.push({
                    label: `${meta.Name} (${meta.Symbol})`,
                    data: points,
                    borderColor: meta.Color,
                    backgroundColor: 'transparent',
                    borderWidth: 1.75,
                    pointRadius: showPoints ? 2.5 : 0,
                    pointHoverRadius: 4.5,
                    pointBackgroundColor: meta.Color,
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 1.5,
                    spanGaps: true,
                    tension: 0.1,
                    metalId: meta.Id
                });
            });
        } else {
            const meta = METALS_DEF.find(m => m.Id === Number(selectedMetalId)) || METALS_DEF[0];
            const metalData = rawData.filter(d => d.MetalId === meta.Id);
            const priceMap = new Map();
            metalData.forEach(d => priceMap.set(d.Date.slice(0, 10), d.Value));

            const points = sortedDates.map(dateKey => {
                const val = priceMap.get(dateKey);
                return val !== undefined ? val : null;
            });

            datasets.push({
                label: `${meta.Name} (${meta.Assay})`,
                data: points,
                borderColor: meta.Color,
                backgroundColor: meta.BgSubtle,
                fill: {
                    target: 'origin',
                    above: meta.BgSubtle
                },
                borderWidth: 2,
                pointRadius: showPoints || points.length < 35 ? 2.5 : 0,
                pointHoverRadius: 5,
                pointBackgroundColor: meta.Color,
                pointBorderColor: '#ffffff',
                pointBorderWidth: 1.5,
                spanGaps: true,
                tension: 0.1,
                metalId: meta.Id
            });
        }

        const labels = sortedDates.map(dStr => formatDateRU(dStr));

        const ChartConstructor = window.Chart;
        if (!ChartConstructor) {
            console.error('Библиотека Chart.js не обнаружена!');
            return null;
        }

        chartInstance = new ChartConstructor(canvas, {
            type: 'line',
            data: {
                labels,
                datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: sortedDates.length > 300 ? 250 : 400,
                    easing: 'easeOutQuart'
                },
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                layout: {
                    padding: {
                        top: 14,
                        bottom: 8,
                        left: 4,
                        right: 14
                    }
                },
                plugins: {
                    legend: {
                        display: selectedMetalId === 'all',
                        position: 'top',
                        align: 'end',
                        labels: {
                            boxWidth: 8,
                            boxHeight: 8,
                            borderRadius: 2,
                            useBorderRadius: true,
                            font: {
                                family: FONT_MONO,
                                size: 11,
                                weight: '500'
                            },
                            color: '#4b5563',
                            padding: 14
                        }
                    },
                    tooltip: {
                        enabled: true,
                        backgroundColor: '#ffffff',
                        titleColor: '#0f172a',
                        bodyColor: '#334155',
                        borderColor: '#e2e8f0',
                        borderWidth: 1,
                        cornerRadius: 6,
                        padding: 10,
                        boxPadding: 4,
                        usePointStyle: true,
                        caretSize: 5,
                        caretPadding: 6,
                        titleFont: {
                            family: FONT_MONO,
                            size: 12,
                            weight: '600'
                        },
                        bodyFont: {
                            family: FONT_MONO,
                            size: 11,
                            weight: '400'
                        },
                        callbacks: {
                            title: (items) => {
                                if (!items || items.length === 0) return '';
                                return items[0].label;
                            },
                            label: (ctx) => {
                                const val = ctx.parsed.y;
                                if (val === null || val === undefined) return '';
                                const dataset = ctx.dataset;
                                if (normalizePercent) {
                                    const sign = val > 0 ? '+' : '';
                                    return ` ${dataset.label}: ${sign}${val.toFixed(2)}%`;
                                }
                                return ` ${dataset.label}: ${val.toFixed(2)} BYN/г`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            display: true,
                            color: 'rgba(15, 23, 42, 0.04)',
                            lineWidth: 1,
                            drawBorder: false
                        },
                        border: {
                            display: true,
                            color: '#e2e8f0',
                            width: 1
                        },
                        ticks: {
                            color: '#64748b',
                            font: {
                                family: FONT_MONO,
                                size: 11
                            },
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 8,
                            padding: 6
                        }
                    },
                    y: {
                        grid: {
                            display: true,
                            color: 'rgba(15, 23, 42, 0.04)',
                            lineWidth: 1,
                            drawBorder: false
                        },
                        border: {
                            display: true,
                            color: '#e2e8f0',
                            width: 1
                        },
                        ticks: {
                            color: '#64748b',
                            font: {
                                family: FONT_MONO,
                                size: 11
                            },
                            padding: 8,
                            callback: (value) => {
                                if (normalizePercent) {
                                    return `${value > 0 ? '+' : ''}${value}%`;
                                }
                                return `${value.toFixed(value < 10 ? 2 : 1)} BYN`;
                            }
                        }
                    }
                }
            }
        });

        return chartInstance;
    }

    function drawEmptyState(canvas) {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.fillStyle = '#64748b';
        ctx.font = `13px ${FONT_UI}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Нет данных для отображения за выбранный период', canvas.width / 2, canvas.height / 2);
        ctx.restore();
    }

    function exportChartAsPNG(filename = 'nbrb-metal-chart.png') {
        if (!chartInstance) return;
        const url = chartInstance.toBase64Image('image/png', 1.0);
        const link = document.createElement('a');
        link.download = filename;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    /* ==========================================================================
       3. ГЛАВНОЕ ПРИЛОЖЕНИЕ (app)
       ========================================================================== */

    const state = {
        selectedMetalId: '0',
        selectedPeriod: '1Y',
        startDate: '',
        endDate: '',
        latestPrices: new Map(),
        currentPrices: [],
        metals: METALS_DEF,
        normalizePercent: false,
        showPoints: false,
        tableSearch: '',
        tablePage: 1,
        tablePageSize: 10,
        isLoading: false
    };

    const dom = {};

    function cacheDomElements() {
        dom.statusDot = document.getElementById('statusDot');
        dom.statusText = document.getElementById('statusText');
        dom.refreshBtn = document.getElementById('refreshBtn');
        dom.exportCsvBtn = document.getElementById('exportCsvBtn');

        dom.heroMetalTitle = document.getElementById('heroMetalTitle');
        dom.heroAssayPill = document.getElementById('heroAssayPill');
        dom.heroPrice = document.getElementById('heroPrice');
        dom.heroDeltaBadge = document.getElementById('heroDeltaBadge');

        dom.metalCardsContainer = document.getElementById('metalCardsContainer');

        dom.periodPills = document.querySelectorAll('.timeframe-btn[data-period]');
        dom.customDateContainer = document.getElementById('customDateContainer');
        dom.dateStartInput = document.getElementById('dateStartInput');
        dom.dateEndInput = document.getElementById('dateEndInput');
        dom.applyCustomDateBtn = document.getElementById('applyCustomDateBtn');

        dom.chartCanvas = document.getElementById('metalChart');
        dom.chartLoadingOverlay = document.getElementById('chartLoadingOverlay');
        dom.loadingMessage = document.getElementById('loadingMessage');
        dom.togglePointsBtn = document.getElementById('togglePointsBtn');
        dom.normalizeToggleWrapper = document.getElementById('normalizeToggleWrapper');
        dom.modeBynBtn = document.getElementById('modeBynBtn');
        dom.modePctBtn = document.getElementById('modePctBtn');
        dom.exportPngBtn = document.getElementById('exportPngBtn');

        dom.statPeriodLabel = document.getElementById('statPeriodLabel');
        dom.statPointsCount = document.getElementById('statPointsCount');
        dom.statMaxPrice = document.getElementById('statMaxPrice');
        dom.statMaxDate = document.getElementById('statMaxDate');
        dom.statMinPrice = document.getElementById('statMinPrice');
        dom.statMinDate = document.getElementById('statMinDate');
        dom.statAvgPrice = document.getElementById('statAvgPrice');

        dom.historyCard = document.getElementById('historyCard');
        dom.historyToggleBtn = document.getElementById('historyToggleBtn');
        dom.tableBody = document.getElementById('tableBody');
        dom.tableCountBadge = document.getElementById('tableCountBadge');
        dom.tableSearchInput = document.getElementById('tableSearchInput');
        dom.prevPageBtn = document.getElementById('prevPageBtn');
        dom.nextPageBtn = document.getElementById('nextPageBtn');
        dom.pageIndicator = document.getElementById('pageIndicator');
    }

    async function initApp() {
        cacheDomElements();
        setupEventListeners();
        updateDateInputsForPeriod(state.selectedPeriod);

        try {
            setLoadingStatus('Синхронизация с api.nbrb.by...');
            const [metals, latest] = await Promise.all([
                fetchMetalsList(),
                fetchLatestPrices()
            ]);

            state.metals = metals;
            if (Array.isArray(latest)) {
                latest.forEach(item => state.latestPrices.set(item.MetalId, item));
            }

            renderMetalTabs();
            setOnlineStatus(true, 'api.nbrb.by: онлайн');
        } catch (e) {
            console.error('Ошибка первичной загрузки:', e);
            setOnlineStatus(false, 'Автономный режим');
            renderMetalTabs();
        }

        await loadChartData();
    }

    function setOnlineStatus(isOnline, text) {
        if (dom.statusDot && dom.statusText) {
            dom.statusDot.className = 'status-dot' + (isOnline ? '' : ' error');
            dom.statusText.textContent = text;
        }
    }

    function setLoadingStatus(message = 'Загрузка данных НБРБ...') {
        if (dom.loadingMessage) dom.loadingMessage.textContent = message;
        if (dom.chartLoadingOverlay) dom.chartLoadingOverlay.classList.add('visible');
        state.isLoading = true;
    }

    function clearLoadingStatus() {
        if (dom.chartLoadingOverlay) dom.chartLoadingOverlay.classList.remove('visible');
        state.isLoading = false;
    }

    function renderMetalTabs() {
        if (!dom.metalCardsContainer) return;
        dom.metalCardsContainer.innerHTML = '';

        const allTab = document.createElement('div');
        allTab.className = `metal-tab ${state.selectedMetalId === 'all' ? 'active' : ''}`;
        allTab.dataset.metalId = 'all';
        allTab.innerHTML = `
            <span class="metal-tab-mark">ALL</span>
            <span class="metal-tab-name">Все 4 металла</span>
        `;
        allTab.addEventListener('click', () => selectMetal('all'));
        dom.metalCardsContainer.appendChild(allTab);

        state.metals.forEach(metal => {
            const latest = state.latestPrices.get(metal.Id);
            const priceText = latest ? `${latest.Value.toFixed(2)} BYN` : '—';
            const tab = document.createElement('div');
            tab.className = `metal-tab ${String(state.selectedMetalId) === String(metal.Id) ? 'active' : ''}`;
            tab.dataset.metalId = metal.Id;

            tab.innerHTML = `
                <span class="metal-tab-mark">${metal.Symbol}</span>
                <span class="metal-tab-name">${metal.Name}</span>
                <span class="metal-tab-price">${priceText}</span>
            `;

            tab.addEventListener('click', () => selectMetal(String(metal.Id)));
            dom.metalCardsContainer.appendChild(tab);
        });
    }

    async function selectMetal(metalId) {
        if (state.selectedMetalId === metalId && !state.isLoading) return;
        state.selectedMetalId = metalId;

        const tabs = dom.metalCardsContainer.querySelectorAll('.metal-tab');
        tabs.forEach(t => {
            if (t.dataset.metalId === String(metalId)) {
                t.classList.add('active');
            } else {
                t.classList.remove('active');
            }
        });

        if (dom.normalizeToggleWrapper) {
            dom.normalizeToggleWrapper.style.display = metalId === 'all' ? 'inline-flex' : 'none';
        }

        await loadChartData();
    }

    function updateDateInputsForPeriod(period) {
        const end = new Date();
        const start = new Date();

        switch (period) {
            case '7D':
                start.setDate(end.getDate() - 7);
                break;
            case '1M':
                start.setMonth(end.getMonth() - 1);
                break;
            case '3M':
                start.setMonth(end.getMonth() - 3);
                break;
            case '6M':
                start.setMonth(end.getMonth() - 6);
                break;
            case '1Y':
                start.setFullYear(end.getFullYear() - 1);
                break;
            case '3Y':
                start.setFullYear(end.getFullYear() - 3);
                break;
            case '5Y':
                start.setFullYear(end.getFullYear() - 5);
                break;
            case 'MAX':
                start.setFullYear(2020, 0, 1);
                break;
            case 'CUSTOM':
                return;
        }

        state.startDate = formatDateISO(start);
        state.endDate = formatDateISO(end);

        if (dom.dateStartInput) dom.dateStartInput.value = state.startDate;
        if (dom.dateEndInput) dom.dateEndInput.value = state.endDate;
    }

    async function loadChartData() {
        setLoadingStatus('Загрузка котировок НБРБ...');

        try {
            const onProgress = (loaded, total) => {
                if (total > 1) {
                    setLoadingStatus(`Загрузка архива: интервал ${loaded} из ${total}...`);
                }
            };

            const rawPrices = await fetchPricesRange(
                state.selectedMetalId,
                state.startDate,
                state.endDate,
                onProgress
            );

            state.currentPrices = rawPrices;
            state.tablePage = 1;

            updateHeroAndStats();
            updateChart();
            renderTable();
            setOnlineStatus(true, 'api.nbrb.by: актуально');
        } catch (err) {
            console.error('Ошибка загрузки котировок:', err);
            setOnlineStatus(false, 'Сбой загрузки данных');
        } finally {
            clearLoadingStatus();
        }
    }

    function updateHeroAndStats() {
        const isAll = state.selectedMetalId === 'all';
        const metal = METALS_DEF.find(m => String(m.Id) === String(state.selectedMetalId));

        if (isAll) {
            if (dom.heroMetalTitle) dom.heroMetalTitle.textContent = 'Сводный обзор металлов';
            if (dom.heroAssayPill) dom.heroAssayPill.textContent = 'Au • Ag • Pt • Pd';

            const goldPrices = state.currentPrices.filter(p => p.MetalId === 0);
            const stats = calculateStats(goldPrices);

            if (stats && dom.heroPrice) {
                dom.heroPrice.textContent = `${stats.currentPrice.toFixed(2)}`;
                const sign = stats.changeAbs > 0 ? '+' : '';
                const cssClass = stats.changeAbs > 0 ? 'up' : (stats.changeAbs < 0 ? 'down' : 'neutral');
                if (dom.heroDeltaBadge) {
                    dom.heroDeltaBadge.className = `hero-delta-badge ${cssClass}`;
                    dom.heroDeltaBadge.textContent = `${sign}${stats.changePercent.toFixed(2)}% (${sign}${stats.changeAbs.toFixed(2)} BYN)`;
                }
            }
            renderStatsStrip(stats);
        } else {
            const stats = calculateStats(state.currentPrices);

            if (dom.heroMetalTitle && metal) dom.heroMetalTitle.textContent = metal.Name;
            if (dom.heroAssayPill && metal) dom.heroAssayPill.textContent = metal.Assay || metal.Symbol;

            if (stats && dom.heroPrice) {
                dom.heroPrice.textContent = `${stats.currentPrice.toFixed(2)}`;
                const sign = stats.changeAbs > 0 ? '+' : '';
                const cssClass = stats.changeAbs > 0 ? 'up' : (stats.changeAbs < 0 ? 'down' : 'neutral');
                if (dom.heroDeltaBadge) {
                    dom.heroDeltaBadge.className = `hero-delta-badge ${cssClass}`;
                    dom.heroDeltaBadge.textContent = `${sign}${stats.changePercent.toFixed(2)}% (${sign}${stats.changeAbs.toFixed(2)} BYN)`;
                }
            }
            renderStatsStrip(stats);
        }
    }

    function renderStatsStrip(stats) {
        if (dom.statPeriodLabel) {
            dom.statPeriodLabel.textContent = `${formatDateRU(state.startDate)} — ${formatDateRU(state.endDate)}`;
        }
        if (dom.statPointsCount) {
            dom.statPointsCount.textContent = stats ? `${stats.totalPoints} торговых дней` : '—';
        }

        if (!stats) {
            if (dom.statMinPrice) dom.statMinPrice.textContent = '—';
            if (dom.statMaxPrice) dom.statMaxPrice.textContent = '—';
            if (dom.statAvgPrice) dom.statAvgPrice.textContent = '—';
            return;
        }

        if (dom.statMinPrice) dom.statMinPrice.textContent = `${stats.minPrice.toFixed(2)} BYN`;
        if (dom.statMinDate) dom.statMinDate.textContent = `от ${formatDateRU(stats.minDate)}`;

        if (dom.statMaxPrice) dom.statMaxPrice.textContent = `${stats.maxPrice.toFixed(2)} BYN`;
        if (dom.statMaxDate) dom.statMaxDate.textContent = `пик ${formatDateRU(stats.maxDate)}`;

        if (dom.statAvgPrice) dom.statAvgPrice.textContent = `${stats.avgPrice.toFixed(2)} BYN`;
    }

    function updateChart() {
        renderMetalChart(dom.chartCanvas, state.currentPrices, state.selectedMetalId, {
            showPoints: state.showPoints,
            normalizePercent: state.selectedMetalId === 'all' && state.normalizePercent
        });
    }

    function renderTable() {
        if (!dom.tableBody) return;
        dom.tableBody.innerHTML = '';

        const query = state.tableSearch.trim().toLowerCase();
        let filtered = state.currentPrices.slice().reverse();

        if (query) {
            filtered = filtered.filter(item => {
                const metal = METALS_DEF.find(m => m.Id === item.MetalId);
                const dateStr = formatDateRU(item.Date);
                const name = metal ? metal.Name.toLowerCase() : '';
                return dateStr.includes(query) || name.includes(query) || String(item.Value).includes(query);
            });
        }

        if (dom.tableCountBadge) {
            dom.tableCountBadge.textContent = `${filtered.length}`;
        }

        const totalPages = Math.ceil(filtered.length / state.tablePageSize) || 1;
        if (state.tablePage > totalPages) state.tablePage = totalPages;
        if (state.tablePage < 1) state.tablePage = 1;

        const startIdx = (state.tablePage - 1) * state.tablePageSize;
        const pageItems = filtered.slice(startIdx, startIdx + state.tablePageSize);

        if (pageItems.length === 0) {
            dom.tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">Записи не найдены</td></tr>`;
        } else {
            pageItems.forEach((item, idx) => {
                const metal = METALS_DEF.find(m => m.Id === item.MetalId) || METALS_DEF[0];
                const tr = document.createElement('tr');

                const prevItem = filtered[startIdx + idx + 1];
                let deltaHtml = `<span style="color: var(--text-faint);">—</span>`;
                if (prevItem && prevItem.MetalId === item.MetalId) {
                    const diff = item.Value - prevItem.Value;
                    const pct = prevItem.Value !== 0 ? (diff / prevItem.Value) * 100 : 0;
                    const sign = diff > 0 ? '+' : '';
                    const color = diff > 0 ? 'var(--delta-up)' : (diff < 0 ? 'var(--delta-down)' : 'var(--text-muted)');
                    deltaHtml = `<span style="color: ${color}; font-weight: 500;" class="mono">${sign}${diff.toFixed(2)} BYN (${sign}${pct.toFixed(2)}%)</span>`;
                }

                tr.innerHTML = `
                    <td class="mono">${formatDateRU(item.Date)}</td>
                    <td>
                        <span class="mono" style="font-weight: 600; font-size: 11px; margin-right: 4px;">${metal.Symbol}</span>
                        <span>${metal.Name}</span>
                    </td>
                    <td class="mono" style="font-weight: 600;">${item.Value.toFixed(2)} BYN</td>
                    <td>${deltaHtml}</td>
                `;
                dom.tableBody.appendChild(tr);
            });
        }

        if (dom.pageIndicator) {
            dom.pageIndicator.textContent = `${state.tablePage} из ${totalPages}`;
        }
        if (dom.prevPageBtn) dom.prevPageBtn.disabled = state.tablePage <= 1;
        if (dom.nextPageBtn) dom.nextPageBtn.disabled = state.tablePage >= totalPages;
    }

    function exportDataAsCSV() {
        if (!state.currentPrices || state.currentPrices.length === 0) {
            alert('Нет данных для экспорта');
            return;
        }

        let csv = '\uFEFFДата;Код металла;Металл;Проба;Цена (BYN/грамм)\n';

        state.currentPrices.forEach(item => {
            const metal = METALS_DEF.find(m => m.Id === item.MetalId) || METALS_DEF[0];
            const dateStr = item.Date.slice(0, 10);
            csv += `${dateStr};${item.MetalId};"${metal.Name}";${metal.Assay || metal.Symbol};${item.Value.toFixed(2).replace('.', ',')}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `nbrb-metals-${state.selectedMetalId}-${state.startDate}-${state.endDate}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    function setupEventListeners() {
        if (dom.refreshBtn) {
            dom.refreshBtn.addEventListener('click', async () => {
                await loadChartData();
            });
        }

        if (dom.exportCsvBtn) {
            dom.exportCsvBtn.addEventListener('click', exportDataAsCSV);
        }

        if (dom.exportPngBtn) {
            dom.exportPngBtn.addEventListener('click', () => {
                exportChartAsPNG(`nbrb-metal-chart-${state.selectedMetalId}.png`);
            });
        }

        if (dom.togglePointsBtn) {
            dom.togglePointsBtn.addEventListener('click', () => {
                state.showPoints = !state.showPoints;
                dom.togglePointsBtn.classList.toggle('active', state.showPoints);
                updateChart();
            });
        }

        if (dom.modeBynBtn && dom.modePctBtn) {
            dom.modeBynBtn.addEventListener('click', () => {
                state.normalizePercent = false;
                dom.modeBynBtn.classList.add('active');
                dom.modePctBtn.classList.remove('active');
                updateChart();
            });

            dom.modePctBtn.addEventListener('click', () => {
                state.normalizePercent = true;
                dom.modePctBtn.classList.add('active');
                dom.modeBynBtn.classList.remove('active');
                updateChart();
            });
        }

        dom.periodPills.forEach(pill => {
            pill.addEventListener('click', async () => {
                const period = pill.dataset.period;
                dom.periodPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');

                state.selectedPeriod = period;

                if (period === 'CUSTOM') {
                    if (dom.customDateContainer) dom.customDateContainer.style.display = 'flex';
                    return;
                }

                if (dom.customDateContainer) dom.customDateContainer.style.display = 'none';
                updateDateInputsForPeriod(period);
                await loadChartData();
            });
        });

        if (dom.applyCustomDateBtn) {
            dom.applyCustomDateBtn.addEventListener('click', async () => {
                const startVal = dom.dateStartInput.value;
                const endVal = dom.dateEndInput.value;

                if (!startVal || !endVal) {
                    alert('Пожалуйста, укажите обе даты: начало и конец диапазона.');
                    return;
                }

                if (new Date(startVal) > new Date(endVal)) {
                    alert('Дата начала не может быть позже даты окончания.');
                    return;
                }

                state.startDate = startVal;
                state.endDate = endVal;
                state.selectedPeriod = 'CUSTOM';

                await loadChartData();
            });
        }

        if (dom.historyToggleBtn && dom.historyCard) {
            dom.historyToggleBtn.addEventListener('click', () => {
                dom.historyCard.classList.toggle('open');
            });
        }

        if (dom.tableSearchInput) {
            dom.tableSearchInput.addEventListener('input', (e) => {
                state.tableSearch = e.target.value;
                state.tablePage = 1;
                renderTable();
            });
        }

        if (dom.prevPageBtn) {
            dom.prevPageBtn.addEventListener('click', () => {
                if (state.tablePage > 1) {
                    state.tablePage--;
                    renderTable();
                }
            });
        }

        if (dom.nextPageBtn) {
            dom.nextPageBtn.addEventListener('click', () => {
                state.tablePage++;
                renderTable();
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp);
    } else {
        initApp();
    }
})();
