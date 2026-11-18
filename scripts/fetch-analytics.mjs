/**
 * Snapshot public GoatCounter HTML into JSON for the analytics page.
 * Uses only the public dashboard (no API token).
 */
const GC_ORIGIN = 'https://helixaiopsassessor.goatcounter.com';
const TZ = 'America/New_York';
const PERIODS = ['day', 'week', 'month', 'quarter', 'half-year', 'year'];
const OUT_DIR = new URL('../data/', import.meta.url);

function todayYmd() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

function shiftDays(ymd, days) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function shiftMonths(ymd, months) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}

function rangeFor(period) {
    const end = todayYmd();
    switch (period) {
        case 'day':
            return { start: end, end };
        case 'week':
            return { start: shiftDays(end, -7), end };
        case 'month':
            return { start: shiftMonths(end, -1), end };
        case 'quarter':
            return { start: shiftMonths(end, -3), end };
        case 'half-year':
            return { start: shiftMonths(end, -6), end };
        case 'year':
            return { start: shiftMonths(end, -12), end };
        default:
            return { start: shiftDays(end, -7), end };
    }
}

function decodeEntities(value) {
    return String(value || '')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ');
}

function attr(tag, name) {
    const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
    return match ? decodeEntities(match[1]) : '';
}

function parseJsonAttr(tag, name) {
    const raw = attr(tag, name);
    if (!raw) return [];
    try {
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

function inner(html, startRe, endTag) {
    const start = html.search(startRe);
    if (start < 0) return '';
    const openEnd = html.indexOf('>', start);
    if (openEnd < 0) return '';
    const close = html.indexOf(endTag, openEnd + 1);
    if (close < 0) return '';
    return html.slice(openEnd + 1, close);
}

function parseHits(html) {
    const body = inner(html, /<tbody\b[^>]*class="[^"]*\bpages\b[^"]*"/i, '</tbody>');
    if (!body) return [];
    const rows = [];
    const re = /<tr\b[^>]*\bdata-id="[^"]+"[^>]*>[\s\S]*?<\/tr>/gi;
    let match;
    while ((match = re.exec(body))) {
        const tr = match[0];
        const open = tr.slice(0, tr.indexOf('>') + 1);
        const chart = (tr.match(/<div\b[^>]*class="[^"]*\bchart-line\b[^"]*"[^>]*>/i) || [''])[0];
        const title = decodeEntities(
            ((tr.match(/<small\b[^>]*class="[^"]*\bpage-title\b[^"]*"[^>]*>([\s\S]*?)<\/small>/i) || [])[1] || '')
                .replace(/<[^>]+>/g, '')
                .replace(/^\|\s*/, '')
                .trim()
        );
        rows.push({
            path: attr(open, 'id'),
            path_id: attr(open, 'data-id'),
            count: Number(attr(open, 'data-count') || 0),
            event: /\bevent\b/.test(attr(open, 'class')),
            title,
            stats: parseJsonAttr(chart, 'data-stats'),
        });
    }
    return rows;
}

function parseHchart(html, title) {
    const blocks = html.match(/<div\b[^>]*class="[^"]*\bhchart\b[^"]*"[^>]*>[\s\S]*?(?=<div\b[^>]*class="[^"]*\bhchart\b|<div\b[^>]*class="[^"]*\btotals\b|<\/div>\s*<\/div>\s*<\/div>\s*<footer)/gi) || [];
    const needle = title.toLowerCase();
    const block = blocks.find((chunk) => {
        const heading = (chunk.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i) || [])[1] || '';
        const text = decodeEntities(heading.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).toLowerCase();
        return text.startsWith(needle);
    });
    if (!block || /class="not-collected"/.test(block)) return [];
    const rows = [];
    const re = /<div\b([^>]*\bdata-key="[^"]+"[^>]*)>[\s\S]*?<\/div>/gi;
    let match;
    while ((match = re.exec(block))) {
        const open = `<div${match[1]}>`;
        const row = match[0];
        const counts = [...row.matchAll(/<span\b[^>]*class="[^"]*\bcol-count\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)].map(
            (m) => decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim()
        );
        const perc = (row.match(/class="[^"]*\bcol-perc\b[^"]*"[^>]*>([\s\S]*?)</i) || [])[1] || '';
        const name = decodeEntities(
            ((row.match(/<span\b[^>]*class="[^"]*\bcutoff\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || '')
                .replace(/<[^>]+>/g, '')
                .trim()
        );
        if (!name) continue;
        rows.push({
            id: attr(open, 'data-key'),
            name,
            count: Number(String(counts[counts.length - 1] || '0').replace(/[^\d]/g, '') || 0),
            pct: parseFloat(perc) || undefined,
        });
    }
    return rows;
}

function parsePublicHtml(html, period) {
    if (!/class="[^"]*\bjs-total\b/.test(html) && !/<tbody\b[^>]*class="[^"]*\bpages\b/.test(html)) {
        throw new Error('Unexpected analytics response');
    }
    const total = Number((html.match(/class="hide js-total"[^>]*>(\d+)/) || [])[1] || 0);
    const start = (html.match(/id="period-start"[^>]*value="([^"]+)"/) || html.match(/id="period-start"[\s\S]*?value="([^"]+)"/))?.[1] || '';
    const end = (html.match(/id="period-end"[^>]*value="([^"]+)"/) || html.match(/id="period-end"[\s\S]*?value="([^"]+)"/))?.[1] || '';
    const totalsTag = (html.match(/<div\b[^>]*class="totals"[^>]*>[\s\S]*?<div\b[^>]*class="[^"]*\bchart-line\b[^"]*"[^>]*>/) || [''])[0];
    const chartTag = (totalsTag.match(/<div\b[^>]*class="[^"]*\bchart-line\b[^"]*"[^>]*>/) || [''])[0];
    return {
        period,
        fetchedAt: new Date().toISOString(),
        total,
        start,
        end,
        hourly: attr(chartTag, 'data-group') === 'hour',
        hits: parseHits(html),
        totals: parseJsonAttr(chartTag, 'data-stats'),
        referrers: parseHchart(html, 'Top referrers'),
        browsers: parseHchart(html, 'Browsers'),
        systems: parseHchart(html, 'Systems'),
        locations: parseHchart(html, 'Locations'),
        sizes: parseHchart(html, 'Sizes'),
    };
}

async function fetchPeriod(period) {
    const { start, end } = rangeFor(period);
    const url = `${GC_ORIGIN}/?no-websocket=1&period-start=${encodeURIComponent(start)}&period-end=${encodeURIComponent(end)}`;
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            const res = await fetch(url, { headers: { Accept: 'text/html' } });
            if (!res.ok) throw new Error(`Could not load public stats for ${period} (${res.status})`);
            return parsePublicHtml(await res.text(), period);
        } catch (err) {
            lastErr = err;
            if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 750));
        }
    }
    throw new Error(`Could not load public stats for ${period}: ${lastErr?.cause?.message || lastErr?.message || lastErr}`);
}

async function main() {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(OUT_DIR, { recursive: true });
    const index = { fetchedAt: new Date().toISOString(), periods: {} };
    for (const period of PERIODS) {
        const data = await fetchPeriod(period);
        const file = new URL(`analytics-${period}.json`, OUT_DIR);
        await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
        index.periods[period] = { start: data.start, end: data.end, total: data.total };
        console.log(`wrote ${file.pathname} (${data.total} visits, ${data.hits.length} paths)`);
    }
    await writeFile(new URL('analytics-index.json', OUT_DIR), `${JSON.stringify(index, null, 2)}\n`);
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
