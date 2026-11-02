/**
 * Главный модуль приложения котировок металлов НБРБ
 */

import {
    METALS_DEF,
    fetchMetalsList,
    fetchLatestPrices,
    fetchPricesRange,
    calculateStats,
    formatDateISO,
    formatDateRU,
    formatDateFullRU
} from './api.js';

import {
    renderMetalChart,
    exportChartAsPNG
} from './chart.js';

// Состояние приложения
const state = {
    selectedMetalId: '0', // 0 = Золото по умолчанию, или 1, 2, 3, 'all'
    selectedPeriod: '1Y', // 7D, 1M, 3M, 6M, 1Y, 3Y, 5Y, MAX, CUSTOM
    startDate: '',
    endDate: '',
    latestPrices: new Map(),
    currentPrices: [], // Записи котировок за выбранный период
    metals: METALS_DEF,
    normalizePercent: false, // Для режима 'all'
    showPoints: false,
    tableSearch: '',
    tablePage: 1,
    tablePageSize: 12,
    isLoading: false
};

// DOM элементы
const dom = {
    // Статус и кнопки шапки
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    refreshBtn: document.getElementById('refreshBtn'),
    exportCsvBtn: document.getElementById('exportCsvBtn'),

    // Карточки металлов
    metalCardsContainer: document.getElementById('metalCardsContainer'),

    // Периоды
    periodPills: document.querySelectorAll('.period-pill'),
    customDateContainer: document.getElementById('customDateContainer'),
    dateStartInput: document.getElementById('dateStartInput'),
    dateEndInput: document.getElementById('dateEndInput'),
    applyCustomDateBtn: document.getElementById('applyCustomDateBtn'),

    // Статистика
    statCurrentPrice: document.getElementById('statCurrentPrice'),
    statCurrentDate: document.getElementById('statCurrentDate'),
    statDelta: document.getElementById('statDelta'),
    statDeltaSub: document.getElementById('statDeltaSub'),
    statMaxPrice: document.getElementById('statMaxPrice'),
    statMaxDate: document.getElementById('statMaxDate'),
    statMinPrice: document.getElementById('statMinPrice'),
    statMinDate: document.getElementById('statMinDate'),
    statAvgPrice: document.getElementById('statAvgPrice'),

    // График
    chartTitle: document.getElementById('chartTitle'),
    chartSubtitle: document.getElementById('chartSubtitle'),
    chartCanvas: document.getElementById('metalChart'),
    chartLoadingOverlay: document.getElementById('chartLoadingOverlay'),
    loadingMessage: document.getElementById('loadingMessage'),
    togglePointsBtn: document.getElementById('togglePointsBtn'),
    normalizeToggleWrapper: document.getElementById('normalizeToggleWrapper'),
    modeBynBtn: document.getElementById('modeBynBtn'),
    modePctBtn: document.getElementById('modePctBtn'),
    exportPngBtn: document.getElementById('exportPngBtn'),

    // Таблица истории
    tableBody: document.getElementById('tableBody'),
    tableCountBadge: document.getElementById('tableCountBadge'),
    tableSearchInput: document.getElementById('tableSearchInput'),
    prevPageBtn: document.getElementById('prevPageBtn'),
    nextPageBtn: document.getElementById('nextPageBtn'),
    pageIndicator: document.getElementById('pageIndicator')
};

/**
 * Инициализация при старте
 */
async function initApp() {
    setupEventListeners();
    updateDateInputsForPeriod(state.selectedPeriod);

    // Загружаем актуальные металлы и текущие котировки
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
        setOnlineStatus(true, 'Онлайн: api.nbrb.by');
    } catch (e) {
        console.error('Ошибка первичной загрузки:', e);
        setOnlineStatus(false, 'Автономный режим');
        renderMetalCards();
    }

    // Загружаем данные для графика
    await loadChartData();
}

/**
 * Установка статуса соединения
 */
function setOnlineStatus(isOnline, text) {
    if (dom.statusDot && dom.statusText) {
        dom.statusDot.className = 'status-dot' + (isOnline ? '' : ' error');
        dom.statusText.textContent = text;
    }
}

/**
 * Установка состояния загрузки
 */
function setLoadingStatus(message = 'Загрузка котировок...') {
    if (dom.loadingMessage) dom.loadingMessage.textContent = message;
    if (dom.chartLoadingOverlay) dom.chartLoadingOverlay.classList.add('visible');
    state.isLoading = true;
}

function clearLoadingStatus() {
    if (dom.chartLoadingOverlay) dom.chartLoadingOverlay.classList.remove('visible');
    state.isLoading = false;
}

/**
 * Отрисовка верхних карточек выбора металла
 */
function renderMetalCards() {
    if (!dom.metalCardsContainer) return;
    dom.metalCardsContainer.innerHTML = '';

    // Карточка "Все металлы"
    const allCard = document.createElement('div');
    allCard.className = `metal-card ${state.selectedMetalId === 'all' ? 'active' : ''}`;
    allCard.dataset.metalId = 'all';
    allCard.innerHTML = `
        <div class="metal-card-header">
            <span class="metal-badge badge-all">Все 4</span>
            <span class="metal-name">Все металлы</span>
        </div>
        <div class="metal-price-row">
            <span class="metal-price" style="font-size: 15px;">Сравнение</span>
            <span class="metal-unit">Au, Ag, Pt, Pd</span>
        </div>
        <div class="metal-delta delta-neutral">Мульти-график</div>
    `;
    allCard.addEventListener('click', () => selectMetal('all'));
    dom.metalCardsContainer.appendChild(allCard);

    // Карточки конкретных металлов
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
                <span class="metal-badge ${badgeClass}">${metal.Symbol}</span>
                <span class="metal-name">${metal.Name}</span>
            </div>
            <div class="metal-price-row">
                <span class="metal-price">${priceText}</span>
                <span class="metal-unit">BYN / г</span>
            </div>
            <div class="metal-delta delta-neutral" id="metalCardDelta_${metal.Id}">Официальный курс</div>
        `;

        card.addEventListener('click', () => selectMetal(String(metal.Id)));
        dom.metalCardsContainer.appendChild(card);
    });
}

/**
 * Выбор металла
 */
async function selectMetal(metalId) {
    if (state.selectedMetalId === metalId && !state.isLoading) return;
    state.selectedMetalId = metalId;

    // Обновляем визуальный активный класс карточек
    const cards = dom.metalCardsContainer.querySelectorAll('.metal-card');
    cards.forEach(c => {
        if (c.dataset.metalId === String(metalId)) {
            c.classList.add('active');
        } else {
            c.classList.remove('active');
        }
    });

    // Показываем переключатель "Нормализовать %" только для режима 'all'
    if (dom.normalizeToggleWrapper) {
        dom.normalizeToggleWrapper.style.display = metalId === 'all' ? 'flex' : 'none';
    }

    await loadChartData();
}

/**
 * Рассчитывает даты начала и окончания для выбранного пресета периода
 */
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
            return; // Не перезаписываем кастомные поля
    }

    state.startDate = formatDateISO(start);
    state.endDate = formatDateISO(end);

    if (dom.dateStartInput) dom.dateStartInput.value = state.startDate;
    if (dom.dateEndInput) dom.dateEndInput.value = state.endDate;
}

/**
 * Загрузка данных для графика и статистики
 */
async function loadChartData() {
    setLoadingStatus('Загрузка данных из НБРБ...');

    try {
        const onProgress = (loaded, total) => {
            if (total > 1) {
                setLoadingStatus(`Загрузка архива: порция ${loaded} из ${total}...`);
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
        setOnlineStatus(true, 'Онлайн: данные актуальны');
    } catch (err) {
        console.error('Ошибка загрузки данных котировок:', err);
        setOnlineStatus(false, 'Сбой загрузки данных');
    } finally {
        clearLoadingStatus();
    }
}

/**
 * Обновление заголовков и карточек статистики
 */
function updateTitlesAndStats() {
    const isAll = state.selectedMetalId === 'all';
    const metal = METALS_DEF.find(m => String(m.Id) === String(state.selectedMetalId));
    const metalName = isAll ? 'Все металлы (сравнение)' : (metal ? `${metal.Name} (${metal.Symbol})` : 'Металл');

    if (dom.chartTitle) {
        dom.chartTitle.textContent = `Динамика курса: ${metalName}`;
    }
    if (dom.chartSubtitle) {
        dom.chartSubtitle.textContent = `Период: с ${formatDateRU(state.startDate)} по ${formatDateRU(state.endDate)} • Официальные данные НБРБ`;
    }

    if (isAll) {
        // В режиме 'all' статистика рассчитывается по Золоту как эталону, либо сводная
        const goldPrices = state.currentPrices.filter(p => p.MetalId === 0);
        const stats = calculateStats(goldPrices);
        renderStatsValues(stats, 'Золото (эталон)');
    } else {
        const stats = calculateStats(state.currentPrices);
        renderStatsValues(stats, metalName);

        // Обновим дельту на карточке выбранного металла
        if (stats && metal) {
            const cardDelta = document.getElementById(`metalCardDelta_${metal.Id}`);
            if (cardDelta) {
                const sign = stats.changeAbs > 0 ? '+' : '';
                const cssClass = stats.changeAbs > 0 ? 'delta-up' : (stats.changeAbs < 0 ? 'delta-down' : 'delta-neutral');
                cardDelta.className = `metal-delta ${cssClass}`;
                cardDelta.textContent = `${sign}${stats.changePercent.toFixed(1)}% (${sign}${stats.changeAbs.toFixed(2)} BYN)`;
            }
        }
    }
}

/**
 * Отрисовка значений в 5 карточках статистики
 */
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
        dom.statCurrentDate.textContent = formatDateRU(stats.lastDate);
    }

    if (dom.statDelta) {
        const sign = stats.changeAbs > 0 ? '+' : '';
        dom.statDelta.textContent = `${sign}${stats.changeAbs.toFixed(2)} BYN`;
        dom.statDelta.style.color = stats.changeAbs > 0 ? 'var(--success)' : (stats.changeAbs < 0 ? 'var(--danger)' : 'var(--text-primary)');
    }
    if (dom.statDeltaSub) {
        const sign = stats.changePercent > 0 ? '+' : '';
        dom.statDeltaSub.textContent = `${sign}${stats.changePercent.toFixed(2)}% за период`;
    }

    if (dom.statMaxPrice) {
        dom.statMaxPrice.textContent = `${stats.maxPrice.toFixed(2)} BYN`;
    }
    if (dom.statMaxDate) {
        dom.statMaxDate.textContent = formatDateRU(stats.maxDate);
    }

    if (dom.statMinPrice) {
        dom.statMinPrice.textContent = `${stats.minPrice.toFixed(2)} BYN`;
    }
    if (dom.statMinDate) {
        dom.statMinDate.textContent = formatDateRU(stats.minDate);
    }

    if (dom.statAvgPrice) {
        dom.statAvgPrice.textContent = `${stats.avgPrice.toFixed(2)} BYN`;
    }
}

/**
 * Обновление графика
 */
function updateChart() {
    renderMetalChart(dom.chartCanvas, state.currentPrices, state.selectedMetalId, {
        showPoints: state.showPoints,
        normalizePercent: state.selectedMetalId === 'all' && state.normalizePercent
    });
}

/**
 * Отрисовка таблицы истории котировок
 */
function renderTable() {
    if (!dom.tableBody) return;
    dom.tableBody.innerHTML = '';

    // Фильтрация по поиску
    const query = state.tableSearch.trim().toLowerCase();
    let filtered = state.currentPrices.slice().reverse(); // Свежие сверху

    if (query) {
        filtered = filtered.filter(item => {
            const metal = METALS_DEF.find(m => m.Id === item.MetalId);
            const dateStr = formatDateRU(item.Date);
            const name = metal ? metal.Name.toLowerCase() : '';
            return dateStr.includes(query) || name.includes(query) || String(item.Value).includes(query);
        });
    }

    if (dom.tableCountBadge) {
        dom.tableCountBadge.textContent = `${filtered.length} записей`;
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

            // Предыдущий элемент для подсчета изменения к предыдущей записи
            const prevItem = filtered[startIdx + idx + 1];
            let deltaHtml = `<span style="color: var(--text-muted);">—</span>`;
            if (prevItem && prevItem.MetalId === item.MetalId) {
                const diff = item.Value - prevItem.Value;
                const pct = prevItem.Value !== 0 ? (diff / prevItem.Value) * 100 : 0;
                const sign = diff > 0 ? '+' : '';
                const color = diff > 0 ? 'var(--success)' : (diff < 0 ? 'var(--danger)' : 'var(--text-secondary)');
                deltaHtml = `<span style="color: ${color}; font-weight: 500;">${sign}${diff.toFixed(2)} BYN (${sign}${pct.toFixed(2)}%)</span>`;
            }

            tr.innerHTML = `
                <td style="font-weight: 500;">${formatDateRU(item.Date)}</td>
                <td>
                    <span class="metal-badge badge-${metal.Symbol.toLowerCase()}">${metal.Symbol}</span>
                    <span style="margin-left: 6px;">${metal.Name}</span>
                </td>
                <td style="font-weight: 600;">${item.Value.toFixed(2)} BYN</td>
                <td>${deltaHtml}</td>
            `;
            dom.tableBody.appendChild(tr);
        });
    }

    // Пагинация
    if (dom.pageIndicator) {
        dom.pageIndicator.textContent = `Стр. ${state.tablePage} из ${totalPages}`;
    }
    if (dom.prevPageBtn) dom.prevPageBtn.disabled = state.tablePage <= 1;
    if (dom.nextPageBtn) dom.nextPageBtn.disabled = state.tablePage >= totalPages;
}

/**
 * Экспорт текущих данных в CSV
 */
function exportDataAsCSV() {
    if (!state.currentPrices || state.currentPrices.length === 0) {
        alert('Нет данных для экспорта');
        return;
    }

    // UTF-8 BOM для корректного открытия в Excel
    let csv = '\uFEFFДата;Код металла;Металл;Символ;Цена (BYN/грамм)\n';

    state.currentPrices.forEach(item => {
        const metal = METALS_DEF.find(m => m.Id === item.MetalId) || METALS_DEF[0];
        const dateStr = item.Date.slice(0, 10);
        csv += `${dateStr};${item.MetalId};"${metal.Name}";${metal.Symbol};${item.Value.toFixed(2).replace('.', ',')}\n`;
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

/**
 * Навешивание обработчиков событий
 */
function setupEventListeners() {
    // Кнопка Обновить
    if (dom.refreshBtn) {
        dom.refreshBtn.addEventListener('click', async () => {
            await loadChartData();
        });
    }

    // Экспорт CSV
    if (dom.exportCsvBtn) {
        dom.exportCsvBtn.addEventListener('click', exportDataAsCSV);
    }

    // Скачать график PNG
    if (dom.exportPngBtn) {
        dom.exportPngBtn.addEventListener('click', () => {
            exportChartAsPNG(`nbrb-metal-chart-${state.selectedMetalId}.png`);
        });
    }

    // Переключатель точек на графике
    if (dom.togglePointsBtn) {
        dom.togglePointsBtn.addEventListener('click', () => {
            state.showPoints = !state.showPoints;
            dom.togglePointsBtn.classList.toggle('active', state.showPoints);
            updateChart();
        });
    }

    // Переключатель BYN / % для 'all'
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

    // Переключение периода (кнопки-пилюли)
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

    // Кнопка "Применить" для произвольного диапазона
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

    // Поиск в таблице
    if (dom.tableSearchInput) {
        dom.tableSearchInput.addEventListener('input', (e) => {
            state.tableSearch = e.target.value;
            state.tablePage = 1;
            renderTable();
        });
    }

    // Пагинация таблицы
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

// Запуск при загрузке документа
document.addEventListener('DOMContentLoaded', initApp);
