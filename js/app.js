/**
 * Главный модуль приложения котировок металлов НБРБ
 * Редизайн в соответствии с принципами Unslop
 */

import {
    METALS_DEF,
    fetchMetalsList,
    fetchLatestPrices,
    fetchPricesRange,
    calculateStats,
    formatDateISO,
    formatDateRU
} from './api.js';

import {
    renderMetalChart,
    exportChartAsPNG
} from './chart.js';

const state = {
    selectedMetalId: '0', // Золото по умолчанию
    selectedPeriod: '1Y', // 1 год
    startDate: '',
    endDate: '',
    latestPrices: new Map(),
    currentPrices: [],
    metals: METALS_DEF,
    normalizePercent: false,
    showPoints: false,
    tableSearch: '',
    tablePage: 1,
    tablePageSize: 12,
    isLoading: false
};

const dom = {};

function cacheDomElements() {
    dom.statusDot = document.getElementById('statusDot');
    dom.statusText = document.getElementById('statusText');
    dom.refreshBtn = document.getElementById('refreshBtn');
    dom.exportCsvBtn = document.getElementById('exportCsvBtn');

    dom.metalCardsContainer = document.getElementById('metalCardsContainer');

    dom.periodPills = document.querySelectorAll('.segment-btn[data-period]');
    dom.customDateContainer = document.getElementById('customDateContainer');
    dom.dateStartInput = document.getElementById('dateStartInput');
    dom.dateEndInput = document.getElementById('dateEndInput');
    dom.applyCustomDateBtn = document.getElementById('applyCustomDateBtn');

    dom.statCurrentPrice = document.getElementById('statCurrentPrice');
    dom.statCurrentDate = document.getElementById('statCurrentDate');
    dom.statDelta = document.getElementById('statDelta');
    dom.statDeltaSub = document.getElementById('statDeltaSub');
    dom.statMaxPrice = document.getElementById('statMaxPrice');
    dom.statMaxDate = document.getElementById('statMaxDate');
    dom.statMinPrice = document.getElementById('statMinPrice');
    dom.statMinDate = document.getElementById('statMinDate');
    dom.statAvgPrice = document.getElementById('statAvgPrice');

    dom.chartTitle = document.getElementById('chartTitle');
    dom.chartSubtitle = document.getElementById('chartSubtitle');
    dom.chartCanvas = document.getElementById('metalChart');
    dom.chartLoadingOverlay = document.getElementById('chartLoadingOverlay');
    dom.loadingMessage = document.getElementById('loadingMessage');
    dom.togglePointsBtn = document.getElementById('togglePointsBtn');
    dom.normalizeToggleWrapper = document.getElementById('normalizeToggleWrapper');
    dom.modeBynBtn = document.getElementById('modeBynBtn');
    dom.modePctBtn = document.getElementById('modePctBtn');
    dom.exportPngBtn = document.getElementById('exportPngBtn');

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

        renderMetalCards();
        setOnlineStatus(true, 'api.nbrb.by: онлайн');
    } catch (e) {
        console.error('Ошибка первичной загрузки:', e);
        setOnlineStatus(false, 'Автономный режим');
        renderMetalCards();
    }

    await loadChartData();
}

function setOnlineStatus(isOnline, text) {
    if (dom.statusDot && dom.statusText) {
        dom.statusDot.className = 'status-dot' + (isOnline ? '' : ' error');
        dom.statusText.textContent = text;
    }
}

function setLoadingStatus(message = 'Загрузка архива котировок...') {
    if (dom.loadingMessage) dom.loadingMessage.textContent = message;
    if (dom.chartLoadingOverlay) dom.chartLoadingOverlay.classList.add('visible');
    state.isLoading = true;
}

function clearLoadingStatus() {
    if (dom.chartLoadingOverlay) dom.chartLoadingOverlay.classList.remove('visible');
    state.isLoading = false;
}

function renderMetalCards() {
    if (!dom.metalCardsContainer) return;
    dom.metalCardsContainer.innerHTML = '';

    // Карточка "Все металлы"
    const allCard = document.createElement('div');
    allCard.className = `metal-card ${state.selectedMetalId === 'all' ? 'active' : ''}`;
    allCard.dataset.metalId = 'all';
    allCard.innerHTML = `
        <div class="metal-card-header">
            <span class="metal-mark-badge">ALL</span>
            <span class="metal-name">Все металлы</span>
        </div>
        <div class="metal-price-row">
            <span class="metal-price" style="font-size: 15px; font-weight: 500;">Сводный обзор</span>
            <span class="metal-unit">Au, Ag, Pt, Pd</span>
        </div>
        <div class="metal-delta-tag delta-neutral">Мульти-график</div>
    `;
    allCard.addEventListener('click', () => selectMetal('all'));
    dom.metalCardsContainer.appendChild(allCard);

    // Карточки отдельных металлов с пробирными метками
    state.metals.forEach(metal => {
        const latest = state.latestPrices.get(metal.Id);
        const priceText = latest ? `${latest.Value.toFixed(2)} BYN` : '—';
        const card = document.createElement('div');
        card.className = `metal-card ${String(state.selectedMetalId) === String(metal.Id) ? 'active' : ''}`;
        card.dataset.metalId = metal.Id;

        let badgeClass = 'badge-gold';
        if (metal.Id === 1) badgeClass = 'badge-silver';
        if (metal.Id === 2) badgeClass = 'badge-platinum';
        if (metal.Id === 3) badgeClass = 'badge-palladium';

        card.innerHTML = `
            <div class="metal-card-header">
                <span class="metal-mark-badge ${badgeClass}">${metal.Assay || metal.Symbol}</span>
                <span class="metal-name">${metal.Name}</span>
            </div>
            <div class="metal-price-row">
                <span class="metal-price">${priceText}</span>
                <span class="metal-unit">BYN / г</span>
            </div>
            <div class="metal-delta-tag delta-neutral" id="metalCardDelta_${metal.Id}">За 1 г слитка</div>
        `;

        card.addEventListener('click', () => selectMetal(String(metal.Id)));
        dom.metalCardsContainer.appendChild(card);
    });
}

async function selectMetal(metalId) {
    if (state.selectedMetalId === metalId && !state.isLoading) return;
    state.selectedMetalId = metalId;

    const cards = dom.metalCardsContainer.querySelectorAll('.metal-card');
    cards.forEach(c => {
        if (c.dataset.metalId === String(metalId)) {
            c.classList.add('active');
        } else {
            c.classList.remove('active');
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
    setLoadingStatus('Загрузка архива НБРБ...');

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

        updateTitlesAndStats();
        updateChart();
        renderTable();
        setOnlineStatus(true, 'api.nbrb.by: актуально');
    } catch (err) {
        console.error('Ошибка загрузки данных котировок:', err);
        setOnlineStatus(false, 'Сбой загрузки данных');
    } finally {
        clearLoadingStatus();
    }
}

function updateTitlesAndStats() {
    const isAll = state.selectedMetalId === 'all';
    const metal = METALS_DEF.find(m => String(m.Id) === String(state.selectedMetalId));
    const metalTitle = isAll
        ? 'Сравнительная динамика котировок (Au, Ag, Pt, Pd)'
        : (metal ? `${metal.Name} (${metal.Assay || metal.Symbol}) — динамика учетной цены` : 'Динамика котировок');

    if (dom.chartTitle) {
        dom.chartTitle.textContent = metalTitle;
    }
    if (dom.chartSubtitle) {
        dom.chartSubtitle.textContent = `${formatDateRU(state.startDate)} — ${formatDateRU(state.endDate)} • Официальные котировки НБРБ`;
    }

    if (isAll) {
        const goldPrices = state.currentPrices.filter(p => p.MetalId === 0);
        const stats = calculateStats(goldPrices);
        renderStatsValues(stats, 'Золото');
    } else {
        const stats = calculateStats(state.currentPrices);
        renderStatsValues(stats, metal ? metal.Name : '');

        if (stats && metal) {
            const cardDelta = document.getElementById(`metalCardDelta_${metal.Id}`);
            if (cardDelta) {
                const sign = stats.changeAbs > 0 ? '+' : '';
                const cssClass = stats.changeAbs > 0 ? 'delta-up' : (stats.changeAbs < 0 ? 'delta-down' : 'delta-neutral');
                cardDelta.className = `metal-delta-tag ${cssClass}`;
                cardDelta.textContent = `${sign}${stats.changePercent.toFixed(1)}% (${sign}${stats.changeAbs.toFixed(2)} BYN)`;
            }
        }
    }
}

function renderStatsValues(stats, contextLabel) {
    if (!stats) {
        if (dom.statCurrentPrice) dom.statCurrentPrice.textContent = '—';
        if (dom.statCurrentDate) dom.statCurrentDate.textContent = 'нет данных';
        if (dom.statDelta) dom.statDelta.textContent = '—';
        if (dom.statMaxPrice) dom.statMaxPrice.textContent = '—';
        if (dom.statMinPrice) dom.statMinPrice.textContent = '—';
        if (dom.statAvgPrice) dom.statAvgPrice.textContent = '—';
        return;
    }

    if (dom.statCurrentPrice) {
        dom.statCurrentPrice.textContent = `${stats.currentPrice.toFixed(2)} BYN`;
    }
    if (dom.statCurrentDate) {
        dom.statCurrentDate.textContent = `на ${formatDateRU(stats.lastDate)}`;
    }

    if (dom.statDelta) {
        const sign = stats.changeAbs > 0 ? '+' : '';
        dom.statDelta.textContent = `${sign}${stats.changeAbs.toFixed(2)} BYN`;
        dom.statDelta.style.color = stats.changeAbs > 0 ? 'var(--delta-pos)' : (stats.changeAbs < 0 ? 'var(--delta-neg)' : 'var(--text-primary)');
    }
    if (dom.statDeltaSub) {
        const sign = stats.changePercent > 0 ? '+' : '';
        dom.statDeltaSub.textContent = `${sign}${stats.changePercent.toFixed(2)}% к началу периода`;
    }

    if (dom.statMaxPrice) {
        dom.statMaxPrice.textContent = `${stats.maxPrice.toFixed(2)} BYN`;
    }
    if (dom.statMaxDate) {
        dom.statMaxDate.textContent = `пик ${formatDateRU(stats.maxDate)}`;
    }

    if (dom.statMinPrice) {
        dom.statMinPrice.textContent = `${stats.minPrice.toFixed(2)} BYN`;
    }
    if (dom.statMinDate) {
        dom.statMinDate.textContent = `минимум ${formatDateRU(stats.minDate)}`;
    }

    if (dom.statAvgPrice) {
        dom.statAvgPrice.textContent = `${stats.avgPrice.toFixed(2)} BYN`;
    }
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
        dom.tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 24px;">Записи не найдены</td></tr>`;
    } else {
        pageItems.forEach((item, idx) => {
            const metal = METALS_DEF.find(m => m.Id === item.MetalId) || METALS_DEF[0];
            const tr = document.createElement('tr');

            const prevItem = filtered[startIdx + idx + 1];
            let deltaHtml = `<span style="color: var(--text-muted);">—</span>`;
            if (prevItem && prevItem.MetalId === item.MetalId) {
                const diff = item.Value - prevItem.Value;
                const pct = prevItem.Value !== 0 ? (diff / prevItem.Value) * 100 : 0;
                const sign = diff > 0 ? '+' : '';
                const color = diff > 0 ? 'var(--delta-pos)' : (diff < 0 ? 'var(--delta-neg)' : 'var(--text-secondary)');
                deltaHtml = `<span style="color: ${color}; font-weight: 500;" class="mono">${sign}${diff.toFixed(2)} BYN (${sign}${pct.toFixed(2)}%)</span>`;
            }

            let badgeClass = 'badge-gold';
            if (metal.Id === 1) badgeClass = 'badge-silver';
            if (metal.Id === 2) badgeClass = 'badge-platinum';
            if (metal.Id === 3) badgeClass = 'badge-palladium';

            tr.innerHTML = `
                <td class="mono">${formatDateRU(item.Date)}</td>
                <td>
                    <span class="metal-mark-badge ${badgeClass}">${metal.Assay || metal.Symbol}</span>
                    <span style="margin-left: 6px;">${metal.Name}</span>
                </td>
                <td class="mono" style="font-weight: 600;">${item.Value.toFixed(2)} BYN</td>
                <td>${deltaHtml}</td>
            `;
            dom.tableBody.appendChild(tr);
        });
    }

    if (dom.pageIndicator) {
        dom.pageIndicator.textContent = `${state.tablePage} / ${totalPages}`;
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
