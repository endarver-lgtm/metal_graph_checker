/**
 * Модуль визуализации графиков котировок с использованием Chart.js
 * Стилизация: Минимализм, светлая тема, скругленные углы, СТРОГО БЕЗ ТЕНЕЙ И БЕЗ ГРАДИЕНТОВ.
 */

import { METALS_DEF, formatDateRU } from './api.js';

let chartInstance = null;

/**
 * Инициализация или обновление графика
 * @param {HTMLCanvasElement} canvas
 * @param {Array} rawData - массив объектов BankIngotPrice
 * @param {number|'all'} selectedMetalId
 * @param {Object} options - { showPoints: boolean, normalizePercent: boolean }
 */
export function renderMetalChart(canvas, rawData, selectedMetalId, options = {}) {
    if (!canvas) return null;
    const { showPoints = false, normalizePercent = false } = options;

    // Уничтожаем старый график, если существует
    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }

    if (!rawData || rawData.length === 0) {
        drawEmptyState(canvas);
        return null;
    }

    // Собираем уникальные даты (отсортированные)
    const dateSet = new Set();
    rawData.forEach(item => dateSet.add(item.Date.slice(0, 10)));
    const sortedDates = Array.from(dateSet).sort();

    // Формируем датасеты
    const datasets = [];

    if (selectedMetalId === 'all') {
        // Режим всех 4 металлов
        METALS_DEF.forEach(meta => {
            const metalData = rawData.filter(d => d.MetalId === meta.Id);
            if (metalData.length === 0) return;

            const priceMap = new Map();
            metalData.forEach(d => priceMap.set(d.Date.slice(0, 10), d.Value));

            // Базовая цена для нормализации (%)
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
                label: meta.Name,
                data: points,
                borderColor: meta.Color,
                backgroundColor: 'transparent', // Без градиентов и без заливки
                borderWidth: 2,
                pointRadius: showPoints ? 3 : 0,
                pointHoverRadius: 5,
                pointBackgroundColor: meta.Color,
                pointBorderColor: '#ffffff',
                pointBorderWidth: 1.5,
                spanGaps: true,
                tension: 0.15,
                metalId: meta.Id
            });
        });
    } else {
        // Режим одного металла
        const meta = METALS_DEF.find(m => m.Id === Number(selectedMetalId)) || METALS_DEF[0];
        const metalData = rawData.filter(d => d.MetalId === meta.Id);
        const priceMap = new Map();
        metalData.forEach(d => priceMap.set(d.Date.slice(0, 10), d.Value));

        const points = sortedDates.map(dateKey => {
            const val = priceMap.get(dateKey);
            return val !== undefined ? val : null;
        });

        datasets.push({
            label: `${meta.Name} (${meta.Symbol})`,
            data: points,
            borderColor: meta.Color,
            backgroundColor: meta.BgLight, // Сплошной плоский цвет (без градиентов!)
            fill: {
                target: 'origin',
                above: meta.BgLight
            },
            borderWidth: 2.2,
            pointRadius: showPoints || points.length < 35 ? 3 : 0,
            pointHoverRadius: 6,
            pointBackgroundColor: meta.Color,
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2,
            spanGaps: true,
            tension: 0.12,
            metalId: meta.Id
        });
    }

    const labels = sortedDates.map(dStr => formatDateRU(dStr));

    // Создаем экземпляр Chart.js
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
                duration: sortedDates.length > 300 ? 300 : 500,
                easing: 'easeOutQuart'
            },
            interaction: {
                mode: 'index',
                intersect: false
            },
            layout: {
                padding: {
                    top: 16,
                    bottom: 12,
                    left: 8,
                    right: 16
                }
            },
            plugins: {
                legend: {
                    display: selectedMetalId === 'all',
                    position: 'top',
                    align: 'end',
                    labels: {
                        boxWidth: 12,
                        boxHeight: 12,
                        borderRadius: 3,
                        useBorderRadius: true,
                        font: {
                            family: 'system-ui, -apple-system, sans-serif',
                            size: 12,
                            weight: '500'
                        },
                        color: '#334155',
                        padding: 16
                    }
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: '#ffffff',
                    titleColor: '#0f172a',
                    bodyColor: '#334155',
                    borderColor: '#cbd5e1',
                    borderWidth: 1,
                    cornerRadius: 8, // Rounded border radius
                    padding: 12,
                    boxPadding: 6,
                    usePointStyle: true,
                    // Строго без теней!
                    caretSize: 6,
                    caretPadding: 8,
                    titleFont: {
                        family: 'system-ui, -apple-system, sans-serif',
                        size: 13,
                        weight: '600'
                    },
                    bodyFont: {
                        family: 'system-ui, -apple-system, sans-serif',
                        size: 12,
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
                            return ` ${dataset.label}: ${val.toFixed(2)} BYN / г`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: true,
                        color: '#f1f5f9',
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
                            family: 'system-ui, -apple-system, sans-serif',
                            size: 11
                        },
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 9,
                        padding: 8
                    }
                },
                y: {
                    grid: {
                        display: true,
                        color: '#f1f5f9',
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
                            family: 'system-ui, -apple-system, sans-serif',
                            size: 11
                        },
                        padding: 10,
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

/**
 * Отрисовка пустого состояния при отсутствии данных
 */
function drawEmptyState(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.fillStyle = '#64748b';
    ctx.font = '14px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Нет данных для отображения за выбранный период', canvas.width / 2, canvas.height / 2);
    ctx.restore();
}

/**
 * Экспорт графика в виде чистого PNG файла
 */
export function exportChartAsPNG(filename = 'nbrb-metal-chart.png') {
    if (!chartInstance) return;
    const url = chartInstance.toBase64Image('image/png', 1.0);
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
