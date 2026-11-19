#!/usr/bin/env python3
"""Record public source changes for review without modifying app data."""
import argparse
from collections import deque
import difflib
import hashlib
import json
import re
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urldefrag, urljoin, urlsplit

HOST = 'www.city.sakaide.lg.jp'
OFFICIAL = (
    f'https://{HOST}/soshiki/seikatukankyou/kateigomi.html',
    f'https://{HOST}/soshiki/seikatukankyou/nenmatsu8nenshi.html',
    f'https://{HOST}/life/1/54/56/',
)
ATTACHMENT = re.compile(r'\.(pdf|xlsx?|csv|zip|docx?)$', re.I)
SCHEDULE_LINK = re.compile(r'収集日|収集予定|ごみ.*(?:年末|年始|カレンダー)|(?:年末|年始).*ごみ')
ATTACHMENT_LABEL = re.compile(r'\b(?:PDF|Excel|CSV|ZIP|Word)\b', re.I)
MAX_BYTES = 20 * 1024 * 1024
MAX_SOURCES = 35


def official_url(url):
    parts = urlsplit(url)
    return parts.scheme == 'https' and parts.netloc == HOST


class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not official_url(newurl):
            raise ValueError('Unexpected redirect from official domain')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text = []
        self.links = []
        self.hidden = 0
        self.href = None
        self.link_text = []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.hidden += 1
        if tag == 'a':
            self.href = dict(attrs).get('href')
            self.link_text = []

    def handle_data(self, data):
        clean = ' '.join(data.split())
        if clean and not self.hidden:
            self.text.append(clean)
            if self.href:
                self.link_text.append(clean)

    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self.hidden:
            self.hidden -= 1
        if tag == 'a' and self.href:
            self.links.append((self.href, ''.join(self.link_text)))
            self.href = None


def fetch(url):
    if not official_url(url):
        raise ValueError('Expected official HTTPS URL')
    client = urllib.request.build_opener(OfficialRedirect())
    request = urllib.request.Request(url, headers={'User-Agent': 'Sakaide-Gomi-ChangeMonitor/1.0'})
    with client.open(request, timeout=15) as response:
        raw = response.read(MAX_BYTES + 1)
        if not raw or len(raw) > MAX_BYTES:
            raise ValueError('Unexpected document size')
        return response.geturl(), response.headers.get_content_type(), response.headers.get_content_charset(), raw


def observe(baseline, output, fetcher=fetch, pages=OFFICIAL, *, archive=False):
    output.mkdir(parents=True, exist_ok=True)
    old = json.loads(baseline.read_text(encoding='utf-8')) if baseline.exists() else {}
    queue = deque((url, True) for url in pages)
    seen, sources, errors = set(), {}, {}
    while queue and len(seen) < MAX_SOURCES:
        url, can_follow_pages = queue.popleft()
        if url in seen:
            continue
        seen.add(url)
        try:
            final, media, charset, raw = fetcher(url)
            digest = hashlib.sha256(raw).hexdigest()
            entry = {'resolved_url': final, 'sha256': digest, 'media_type': media}
            stub = hashlib.sha256(url.encode()).hexdigest()[:16]
            if media in ('text/html', 'application/xhtml+xml'):
                page = Page()
                page.feed(raw.decode(charset or 'utf-8'))
                page.close()
                if not page.text:
                    raise ValueError('Empty HTML body')
                targets = []
                for href, label in page.links:
                    target = urldefrag(urljoin(final, href)).url
                    if not official_url(target):
                        continue
                    attached = bool(ATTACHMENT.search(urlsplit(target).path) or ATTACHMENT_LABEL.search(label))
                    if attached or (can_follow_pages and SCHEDULE_LINK.search(label)):
                        targets.append(target)
                        queue.append((target, False))
                entry['text'] = '\n'.join(page.text + sorted(set(targets))) + '\n'
                entry['sha256'] = hashlib.sha256(entry['text'].encode()).hexdigest()
                filename = stub + '.html'
            else:
                suffix = ATTACHMENT.search(urlsplit(final).path)
                filename = stub + (suffix.group(0).lower() if suffix else '.bin')
            if archive or (media not in ('text/html', 'application/xhtml+xml')
                           and old.get(url, {}).get('sha256') != digest):
                (output / filename).write_bytes(raw)
                entry['artifact'] = filename
                entry['artifact_sha256'] = digest
            sources[url] = entry
        except (OSError, ValueError, LookupError) as exc:
            errors[url] = str(exc)
    if any(url not in seen for url, _ in queue):
        errors['limit'] = 'Too many linked documents. Review target links manually.'
    changed = []
    established = baseline.exists()
    for url in sorted(set(old) | set(sources)):
        previous, current = old.get(url), sources.get(url)
        if current is None and errors:
            continue  # An incomplete crawl cannot establish that a page was removed.
        if previous and current and (previous['sha256'], previous['resolved_url']) == (current['sha256'], current['resolved_url']):
            continue
        kind = 'new' if not previous else 'removed' if not current else 'modified'
        changes = {'url': url, 'kind': kind, 'before': previous and previous['sha256'],
                   'after': current and current['sha256']}
        changed.append(changes)
        before, after = (previous or {}).get('text', ''), (current or {}).get('text', '')
        if before or after:
            diff = difflib.unified_diff(before.splitlines(keepends=True), after.splitlines(keepends=True),
                                        fromfile='baseline', tofile='observed')
            stub = hashlib.sha256(url.encode()).hexdigest()[:16]
            (output / f'{stub}.diff').write_text(''.join(diff), encoding='utf-8')
    snapshot = {url: {k: v for k, v in entry.items() if k not in ('artifact', 'artifact_sha256')} for url, entry in sources.items()}
    report = {'checked_utc': datetime.now(timezone.utc).isoformat(), 'baseline_present': established,
              'sources': sources, 'changed': changed, 'errors': errors,
              'requires_human_review': bool(changed or errors or not established)}
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if not errors:
        (output / 'proposed-baseline.json').write_text(
            json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path, default=Path('reference/official-baseline.json'))
    parser.add_argument('--output', type=Path, default=Path('monitor-result'))
    parser.add_argument('--archive', action='store_true', help='Save originals of all successfully fetched sources')
    args = parser.parse_args()
    report = observe(args.baseline, args.output, archive=args.archive)
    print(f"{len(report['sources'])} sources, {len(report['changed'])} changes, {len(report['errors'])} errors")
    return int(bool(report['errors']))


if __name__ == '__main__':
    raise SystemExit(main())
