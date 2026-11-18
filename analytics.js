(() => {
    const PERIODS = [
        { id: 'day', label: 'Day' },
        { id: 'week', label: 'Week' },
        { id: 'month', label: 'Month' },
        { id: 'quarter', label: 'Quarter' },
        { id: 'half-year', label: 'Half year' },
        { id: 'year', label: 'Year' },
    ];
    const COLORS = ['#007AE2', '#FF5C28', '#10b981', '#f59e0b', '#a78bfa', '#38bdf8', '#fb7185', '#94a3b8'];
    const FUNNEL = [
        { key: '/AIOpsAssessor', label: 'Page visits', icon: 'eye' },
        { key: 'start-assessment', label: 'Started assessment', icon: 'play' },
        { key: 'finish-assessment', label: 'Finished assessment', icon: 'check-circle' },
        { key: 'share-results', label: 'Shared results', icon: 'share-2' },
        { key: 'contact-sales', label: 'Contacted sales', icon: 'briefcase' },
    ];

    const state = {
        period: 'week',
        loading: false,
    };

    const $ = (id) => document.getElementById(id);

    function fmt(n) {
        return Number(n || 0).toLocaleString('en-US');
    }

    function pct(part, whole) {
        if (!whole) return '—';
        return `${Math.round((part / whole) * 100)}%`;
    }

    function showError(msg) {
        const el = $('error-banner');
        if (!msg) {
            el.classList.add('hidden');
            el.textContent = '';
            return;
        }
        el.classList.remove('hidden');
        el.textContent = msg;
    }

    function prettyRange(start, end) {
        const opts = { month: 'short', day: 'numeric', year: 'numeric' };
        const a = start ? new Date(`${start}T12:00:00`) : null;
        const b = end ? new Date(`${end}T12:00:00`) : null;
        if (!a || Number.isNaN(a.getTime())) return 'Selected range';
        if (!b || Number.isNaN(b.getTime()) || start === end) {
            return a.toLocaleDateString('en-US', opts);
        }
        return `${a.toLocaleDateString('en-US', opts)} – ${b.toLocaleDateString('en-US', opts)}`;
    }

    function seriesValues(stats, hourly) {
        if (!Array.isArray(stats) || !stats.length) return [];
        if (hourly) {
            return stats.flatMap((day) =>
                (day.hourly || []).map((count, hour) => ({
                    label: `${day.day} ${String(hour).padStart(2, '0')}:00`,
                    value: Number(count || 0),
                }))
            );
        }
        return stats.map((day) => ({
            label: day.day,
            value: Number(day.daily || 0),
        }));
    }

    function sparkSvg(stats, color = '#007AE2') {
        const pts = seriesValues(stats, false).map((p) => p.value);
        if (!pts.length) return '';
        const w = 88;
        const h = 28;
        const max = Math.max(...pts, 1);
        const path = pts
            .map((v, i) => {
                const x = pts.length === 1 ? w / 2 : (i / (pts.length - 1)) * w;
                const y = h - (v / max) * (h - 2) - 1;
                return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(' ');
        return `<svg viewBox="0 0 ${w} ${h}" class="w-24 h-7" preserveAspectRatio="none"><path d="${path}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }

    function areaChart(points) {
        if (!points.length) {
            return `<div class="h-full flex items-center justify-center text-slate-500 text-sm">No traffic in this range</div>`;
        }
        const w = 720;
        const h = 200;
        const padL = 8;
        const padR = 8;
        const padT = 12;
        const padB = 28;
        const max = Math.max(...points.map((p) => p.value), 1);
        const innerW = w - padL - padR;
        const innerH = h - padT - padB;
        const xy = points.map((p, i) => {
            const x = padL + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
            const y = padT + innerH - (p.value / max) * innerH;
            return { ...p, x, y };
        });
        const line = xy.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        const area = `${line} L${xy[xy.length - 1].x.toFixed(1)},${(padT + innerH).toFixed(1)} L${xy[0].x.toFixed(1)},${(padT + innerH).toFixed(1)} Z`;
        const ticks = [xy[0], xy[Math.floor(xy.length / 2)], xy[xy.length - 1]].filter(Boolean);
        const tickSvg = ticks
            .map((p) => {
                const label = p.label.length > 10 ? p.label.slice(5) : p.label;
                return `<text x="${p.x.toFixed(1)}" y="${h - 8}" text-anchor="middle" fill="#64748b" font-size="11">${label}</text>`;
            })
            .join('');
        return `<svg viewBox="0 0 ${w} ${h}" class="w-full h-full" preserveAspectRatio="none">
            <defs>
                <linearGradient id="trafficFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#007AE2" stop-opacity="0.35"/>
                    <stop offset="100%" stop-color="#007AE2" stop-opacity="0"/>
                </linearGradient>
            </defs>
            <path d="${area}" fill="url(#trafficFill)"></path>
            <path d="${line}" fill="none" stroke="#007AE2" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path>
            ${tickSvg}
        </svg>`;
    }

    function barList(items, empty = 'Nothing to display') {
        if (!items || !items.length) {
            return `<p class="text-sm text-slate-500">${empty}</p>`;
        }
        const max = Math.max(...items.map((i) => i.count), 1);
        return items
            .map((item, idx) => {
                const width = Math.max(4, (item.count / max) * 100);
                const color = COLORS[idx % COLORS.length];
                return `<div class="mb-3 last:mb-0">
                    <div class="flex items-center justify-between gap-3 text-sm mb-1">
                        <span class="text-slate-200 truncate" title="${item.name}">${item.name}</span>
                        <span class="text-slate-400 font-semibold tabular-nums shrink-0">${fmt(item.count)}${item.pct != null ? ` · ${item.pct}%` : ''}</span>
                    </div>
                    <div class="h-2 rounded-full bg-slate-900 overflow-hidden">
                        <div class="bar-fill h-full rounded-full" style="width:${width}%;background:${color}"></div>
                    </div>
                </div>`;
            })
            .join('');
    }

    function skeletonKpis() {
        $('kpi-row').innerHTML = Array.from({ length: 4 }, () =>
            `<div class="rounded-2xl border border-slate-700 bg-slate-800/40 p-5"><div class="skeleton h-3 w-20 rounded mb-3"></div><div class="skeleton h-8 w-16 rounded"></div></div>`
        ).join('');
        ['traffic-chart', 'funnel', 'paths-table', 'referrers', 'browsers', 'systems', 'locations', 'sizes'].forEach((id) => {
            $(id).innerHTML = `<div class="skeleton h-40 rounded-2xl"></div>`;
        });
    }

    function renderPeriodPills() {
        $('period-pills').innerHTML = PERIODS.map(
            (p) => `<button data-period="${p.id}" class="period-btn px-3.5 py-2 rounded-full text-sm font-semibold border transition-all ${
                p.id === state.period
                    ? 'bg-bmc-blue text-white border-bmc-blue shadow-[0_0_20px_rgba(0,122,226,0.25)]'
                    : 'bg-slate-800/70 text-slate-300 border-slate-700 hover:border-slate-500 hover:text-white'
            }">${p.label}</button>`
        ).join('');
        $('period-pills').querySelectorAll('.period-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                state.period = btn.dataset.period;
                renderPeriodPills();
                load();
            });
        });
    }

    function hitCount(hits, key) {
        const hit = hits.find((h) => h.path === key);
        return hit ? Number(hit.count || 0) : 0;
    }

    function render(data) {
        const hits = data.hits || [];
        const visits = Number(data.total || 0);
        const pageVisits = hitCount(hits, '/AIOpsAssessor');
        const started = hitCount(hits, 'start-assessment');
        const finished = hitCount(hits, 'finish-assessment');
        const shared = hitCount(hits, 'share-results');
        const contacted = hitCount(hits, 'contact-sales');
        const completeRate = pct(finished, started);

        $('range-label').textContent = `${prettyRange(data.start, data.end)} · ${fmt(visits)} unique visits`;
        $('traffic-peak').textContent = data.hourly ? 'By hour' : 'By day';
        if ($('updated-label') && data.fetchedAt) {
            const when = new Date(data.fetchedAt);
            $('updated-label').textContent = Number.isNaN(when.getTime())
                ? 'Totals update about once an hour'
                : `Updated ${when.toLocaleString('en-US')} · refresh about once an hour`;
        }

        const kpis = [
            { label: 'Unique visits', value: visits, hint: 'All paths & events', icon: 'users', color: 'text-bmc-blue' },
            { label: 'Assessments started', value: started, hint: pct(started, pageVisits || visits) + ' of page visits', icon: 'play', color: 'text-bmc-orange' },
            { label: 'Assessments finished', value: finished, hint: completeRate + ' completion', icon: 'check-circle', color: 'text-emerald-400' },
            { label: 'Sales contacts', value: contacted, hint: `${fmt(shared)} shares`, icon: 'briefcase', color: 'text-amber-400' },
        ];
        $('kpi-row').innerHTML = kpis
            .map(
                (k) => `<div class="rounded-2xl border border-slate-700 bg-slate-800/50 p-5 fade-in">
                    <div class="flex items-center justify-between mb-3">
                        <p class="text-[11px] font-bold uppercase tracking-wider text-slate-500">${k.label}</p>
                        <i data-lucide="${k.icon}" class="w-4 h-4 ${k.color}"></i>
                    </div>
                    <p class="text-3xl font-black text-white tabular-nums">${fmt(k.value)}</p>
                    <p class="text-xs text-slate-500 mt-1">${k.hint}</p>
                </div>`
            )
            .join('');

        const useHourly = state.period === 'day' || data.hourly;
        const trafficPts = seriesValues(data.totals || [], useHourly).filter((p) => p.label);
        $('traffic-chart').innerHTML = areaChart(trafficPts);

        const funnelCounts = FUNNEL.map((step) => ({ ...step, count: hitCount(hits, step.key) }));
        const funnelMax = Math.max(...funnelCounts.map((s) => s.count), 1);
        $('funnel').innerHTML = funnelCounts
            .map((step, i) => {
                const prev = i === 0 ? step.count : funnelCounts[i - 1].count;
                const width = Math.max(8, (step.count / funnelMax) * 100);
                const drop = i === 0 ? '' : `<span class="text-[11px] text-slate-500">${pct(step.count, prev)} of previous</span>`;
                return `<div>
                    <div class="flex items-center justify-between text-sm mb-1.5">
                        <span class="text-slate-200">${step.label}</span>
                        <span class="font-semibold tabular-nums">${fmt(step.count)}</span>
                    </div>
                    <div class="h-3 rounded-full bg-slate-900 overflow-hidden">
                        <div class="bar-fill h-full rounded-full bg-gradient-to-r from-bmc-blue to-bmc-orange" style="width:${width}%"></div>
                    </div>
                    ${drop ? `<div class="mt-1">${drop}</div>` : ''}
                </div>`;
            })
            .join('');

        const maxHit = Math.max(...hits.map((h) => h.count), 1);
        $('paths-table').innerHTML = hits.length
            ? `<div class="space-y-3">${hits
                  .map((h) => {
                      const width = Math.max(4, (h.count / maxHit) * 100);
                      return `<div class="flex items-center gap-3">
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2">
                                <p class="text-sm text-white truncate">${h.title || h.path}</p>
                                ${h.event ? '<span class="text-[10px] uppercase tracking-wider font-bold text-bmc-orange bg-bmc-orange/10 border border-bmc-orange/20 rounded-full px-1.5 py-0.5">event</span>' : ''}
                            </div>
                            <p class="text-[11px] text-slate-500 truncate">${h.path}</p>
                            <div class="h-1.5 mt-2 rounded-full bg-slate-900 overflow-hidden">
                                <div class="bar-fill h-full rounded-full ${h.event ? 'bg-bmc-orange' : 'bg-bmc-blue'}" style="width:${width}%"></div>
                            </div>
                        </div>
                        <div class="hidden sm:block">${sparkSvg(h.stats, h.event ? '#FF5C28' : '#007AE2')}</div>
                        <p class="w-10 text-right font-bold tabular-nums">${fmt(h.count)}</p>
                    </div>`;
                  })
                  .join('')}</div>`
            : `<p class="text-sm text-slate-500">No pages in this range</p>`;

        $('referrers').innerHTML = barList(data.referrers, 'No referrers recorded');
        $('browsers').innerHTML = barList(data.browsers);
        $('systems').innerHTML = barList(data.systems);
        $('locations').innerHTML = barList(data.locations);
        $('sizes').innerHTML = barList(data.sizes);

        if (window.lucide) lucide.createIcons();
    }

    async function fetchSnapshot(period) {
        const url = new URL(`data/analytics-${period}.json`, window.location.href);
        url.searchParams.set('t', String(Date.now()));
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Could not load analytics data (${res.status})`);
        const data = await res.json();
        if (!data || !Array.isArray(data.hits)) throw new Error('Unexpected analytics response');
        return data;
    }

    async function load() {
        if (state.loading) return;
        state.loading = true;
        showError('');
        skeletonKpis();
        try {
            render(await fetchSnapshot(state.period));
        } catch (err) {
            showError(err.message || 'Could not load analytics.');
            ['traffic-chart', 'funnel', 'paths-table', 'referrers', 'browsers', 'systems', 'locations', 'sizes'].forEach((id) => {
                $(id).innerHTML = `<p class="text-sm text-slate-500">Waiting for data</p>`;
            });
            $('kpi-row').innerHTML = '';
        } finally {
            state.loading = false;
            if (window.lucide) lucide.createIcons();
        }
    }

    function bind() {
        renderPeriodPills();
        $('btn-refresh').addEventListener('click', () => load());
        if (window.lucide) lucide.createIcons();
        load();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }
})();
