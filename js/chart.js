/**
 * Модуль визуализации графиков котировок с использованием Chart.js
 * Стилизация по правилам unslop:
 *  - Моноширинные метки шкал и значений (JetBrains Mono / monospace)
 *  - Тонкие нейтральные разделители hairlines (rgba(17, 24, 39, 0.05))
 *  - Чистый плоский тултип без теней с вложенным скруглением (6px)
 *  - СТРОГО БЕЗ ТЕНЕЙ И БЕЗ ГРАДИЕНТОВ
 */

import { METALS_DEF, formatDateRU } from './api.js';

let chartInstance = null;

const FONT_MONO = 'ui-monospace, "JetBrains Mono", "Geist Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace';
const FONT_UI = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

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
                    titleColor: '#111827',
                    bodyColor: '#374151',
                    borderColor: '#e5e7eb',
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
                        color: 'rgba(17, 24, 39, 0.04)',
                        lineWidth: 1,
                        drawBorder: false
                    },
                    border: {
                        display: true,
                        color: '#e5e7eb',
                        width: 1
                    },
                    ticks: {
                        color: '#6b7280',
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
                        color: 'rgba(17, 24, 39, 0.04)',
                        lineWidth: 1,
                        drawBorder: false
                    },
                    border: {
                        display: true,
                        color: '#e5e7eb',
                        width: 1
                    },
                    ticks: {
                        color: '#6b7280',
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
    ctx.fillStyle = '#6b7280';
    ctx.font = `13px ${FONT_UI}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Нет данных для отображения за выбранный период', canvas.width / 2, canvas.height / 2);
    ctx.restore();
}

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
