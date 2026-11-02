/**
 * API модуль для работы с открытым API Национального банка Республики Беларусь (НБРБ)
 * Документация: https://www.nbrb.by/apihelp/bankingots
 */

export const METALS_DEF = [
    { Id: 0, Symbol: 'Au', Name: 'Золото', NameEng: 'Gold', NameBel: 'Золата', Color: '#b45309', BgLight: '#fef3c7', Border: '#f59e0b' },
    { Id: 1, Symbol: 'Ag', Name: 'Серебро', NameEng: 'Silver', NameBel: 'Серабро', Color: '#475569', BgLight: '#f1f5f9', Border: '#94a3b8' },
    { Id: 2, Symbol: 'Pt', Name: 'Платина', NameEng: 'Platinum', NameBel: 'Плаціна', Color: '#2563eb', BgLight: '#eff6ff', Border: '#60a5fa' },
    { Id: 3, Symbol: 'Pd', Name: 'Палладий', NameEng: 'Palladium', NameBel: 'Паладый', Color: '#0f766e', BgLight: '#ccfbf1', Border: '#2dd4bf' }
];

const API_BASE = 'https://api.nbrb.by';

// Кэш в памяти для избежания повторных одинаковых запросов
const memoryCache = new Map();

/**
 * Преобразование даты в формат YYYY-MM-DD
 */
export function formatDateISO(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Читаемый формат даты DD.MM.YYYY
 */
export function formatDateRU(date) {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

/**
 * Длинный читаемый формат даты (напр., "2 ноября 2026")
 */
export function formatDateFullRU(date) {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

/**
 * Получение перечня металлов
 * https://api.nbrb.by/metals
 */
export async function fetchMetalsList() {
    const cacheKey = 'metals_list';
    if (memoryCache.has(cacheKey)) {
        return memoryCache.get(cacheKey);
    }

    try {
        const res = await fetch(`${API_BASE}/metals`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });

        if (!res.ok) throw new Error(`Ошибка загрузки металлов: HTTP ${res.status}`);
        const metals = await res.json();

        // Обогащаем металлы визуальными атрибутами (цвета, символы)
        const enriched = metals.map(m => {
            const def = METALS_DEF.find(d => d.Id === m.Id) || METALS_DEF[0];
            return {
                ...m,
                Symbol: def.Symbol,
                Color: def.Color,
                BgLight: def.BgLight,
                Border: def.Border
            };
        });

        memoryCache.set(cacheKey, enriched);
        return enriched;
    } catch (err) {
        console.warn('Не удалось загрузить металлы с API, используем справочник по умолчанию:', err);
        return METALS_DEF;
    }
}

/**
 * Получение актуальных котировок на конкретную дату (или последнюю доступную)
 * https://api.nbrb.by/v2/bankingots/prices
 */
export async function fetchLatestPrices() {
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

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            memoryCache.set(cacheKey, data);
            return data;
        }
    } catch (err) {
        console.warn('Не удалось загрузить цены через /v2/bankingots/prices:', err);
    }

    // Запасной вариант: запросить последние 7 дней через /bankingots/prices
    const past = new Date();
    past.setDate(past.getDate() - 7);
    const recent = await fetchPricesRange('all', formatDateISO(past), dateStr);
    
    // Находим самые свежие записи для каждого металла
    const latestMap = new Map();
    for (const item of recent) {
        const existing = latestMap.get(item.MetalId);
        if (!existing || new Date(item.Date) > new Date(existing.Date)) {
            latestMap.set(item.MetalId, item);
        }
    }
    return Array.from(latestMap.values());
}

/**
 * Разбивка интервала дат на отрезки не более 360 дней
 * (ограничение API НБРБ: не более 365 дней за один запрос)
 */
export function splitDateRange(startDateStr, endDateStr, maxChunkDays = 360) {
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

/**
 * Запрос цен за период (с автоматической разбивкой на части при > 365 дней)
 * @param {number|'all'} metalId - Id металла (0 - Золото, 1 - Серебро, 2 - Платина, 3 - Палладий) или 'all'
 * @param {string} startDateStr - YYYY-MM-DD
 * @param {string} endDateStr - YYYY-MM-DD
 * @param {function} onProgress - колбэк прогресса загрузки (loaded, total)
 */
export async function fetchPricesRange(metalId, startDateStr, endDateStr, onProgress = null) {
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
                console.error(`Ошибка при запросе части ${chunk.start}..${chunk.end}: HTTP ${res.status}`);
                return [];
            }
            const data = await res.json();
            completed++;
            if (onProgress) {
                onProgress(completed, chunks.length);
            }
            return Array.isArray(data) ? data : [];
        } catch (e) {
            console.error(`Сетевой сбой при загрузке ${chunk.start}..${chunk.end}:`, e);
            completed++;
            if (onProgress) onProgress(completed, chunks.length);
            return [];
        }
    };

    // Выполняем запросы пачками (до 3 параллельных для бережного отношения к серверу НБРБ)
    const results = [];
    const batchSize = 3;
    for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(fetchChunk));
        for (const r of batchResults) {
            results.push(...r);
        }
    }

    // Дедупликация и хронологическая сортировка
    const uniqueMap = new Map();
    for (const item of results) {
        // Уникальный ключ: MetalId + Дата
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

/**
 * Расчет аналитических показателей за период
 */
export function calculateStats(priceRecords) {
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
