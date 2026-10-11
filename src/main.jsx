import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertCircle, ArrowDown, ArrowDownUp, ArrowUp, Check, CheckCheck,
  ChevronDown, CircleHelp, Clipboard, Clock3, ExternalLink, Eye,
  FileDown, KeyRound, LoaderCircle, LockKeyhole, Play, RotateCcw, Search,
  Settings2, ShieldCheck, Sparkles, Video,
} from 'lucide-react';
import './style.css';

const PER_PAGE = 50;
const formatViews = (number) => number == null ? '—' : new Intl.NumberFormat('en-US').format(number);
const formatDate = (value) => {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
};

async function fetchPlaylistVideos(playlistId, apiKey) {
  let token = '';
  let items = [];
  let playlistTitle = '';
  do {
    const params = new URLSearchParams({
      part: 'snippet,contentDetails', maxResults: '50', playlistId, key: apiKey,
      ...(token ? { pageToken: token } : {}),
    });
    const response = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`);
    const body = await response.json();
    if (!response.ok) {
      const reason = body.error?.errors?.[0]?.reason;
      if (reason === 'keyInvalid' || reason === 'keyExpired') throw new Error('That API key is invalid or expired. Double-check the key and try again.');
      if (reason === 'quotaExceeded') throw new Error('This API key has reached its daily quota. YouTube resets the quota at midnight Pacific time.');
      if (reason === 'playlistNotFound') throw new Error('We couldn’t find that playlist. Check the playlist ID and make sure the playlist is public or unlisted.');
      if (reason === 'forbidden' || reason === 'playlistItemsNotAccessible') throw new Error('This playlist isn’t accessible with the provided key. Only public and unlisted playlists are supported.');
      throw new Error(body.error?.message || 'YouTube couldn’t load that playlist. Please try again.');
    }
    playlistTitle ||= body.items?.[0]?.snippet?.channelTitle || '';
    items = items.concat((body.items || []).filter((item) => item.snippet?.resourceId?.videoId && item.snippet.title !== 'Private video' && item.snippet.title !== 'Deleted video').map((item) => ({
      id: item.snippet.resourceId.videoId,
      title: item.snippet.title || 'Untitled video',
      thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
      date: item.contentDetails?.videoPublishedAt || item.snippet.publishedAt,
      views: null,
    })));
    token = body.nextPageToken || '';
  } while (token);

  // Look up video statistics and original upload dates in batches of 50.
  for (let start = 0; start < items.length; start += 50) {
    const ids = items.slice(start, start + 50).map((item) => item.id).join(',');
    const params = new URLSearchParams({ part: 'snippet,statistics', id: ids, key: apiKey });
    const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || 'YouTube couldn’t load video details.');
    const byId = new Map((body.items || []).map((item) => [item.id, item]));
    items = items.map((item) => {
      const video = byId.get(item.id);
      return video ? { ...item, title: video.snippet?.title || item.title, date: video.snippet?.publishedAt || item.date, views: Number(video.statistics?.viewCount) } : item;
    });
  }
  return { items, playlistTitle };
}

const SortButton = ({ label, active, direction, onClick, className = '' }) => (
  <button className={`sort-button ${active ? 'is-active' : ''} ${className}`} onClick={onClick}>
    {label}{active ? direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowDownUp size={11} className="sort-idle" />}
  </button>
);

function App() {
  const [playlistInput, setPlaylistInput] = useState('');
  const [keyInput, setKeyInput] = useState(() => sessionStorage.getItem('playlist-index-key') || '');
  const [showKey, setShowKey] = useState(false);
  const [showKeyHelp, setShowKeyHelp] = useState(false);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [playlistName, setPlaylistName] = useState('');
  const [activePlaylistId, setActivePlaylistId] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [sort, setSort] = useState({ key: 'order', direction: 'asc' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(() => {
    let result = videos.filter((video) => video.title.toLowerCase().includes(search.toLowerCase()));
    result = [...result].sort((a, b) => {
      if (sort.key === 'title') return sort.direction === 'asc' ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title);
      if (sort.key === 'date') return sort.direction === 'asc' ? String(a.date).localeCompare(String(b.date)) : String(b.date).localeCompare(String(a.date));
      if (sort.key === 'views') return sort.direction === 'asc' ? (a.views ?? -1) - (b.views ?? -1) : (b.views ?? -1) - (a.views ?? -1);
      return sort.direction === 'asc' ? a.order - b.order : b.order - a.order;
    });
    return result;
  }, [videos, search, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageRows = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const visibleSelectedCount = pageRows.filter((v) => selected.has(v.id)).length;
  const allVisibleSelected = pageRows.length > 0 && visibleSelectedCount === pageRows.length;

  const showToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2400);
  };

  const handleLoad = async (event) => {
    event?.preventDefault();
    setError('');
    setToast('');
    if (!keyInput.trim()) { setShowSettings(true); setError('Add a YouTube Data API key in settings to fetch playlist details.'); return; }
    const match = playlistInput.trim().match(/(?:list=|youtube\.com\/playlist\?list=|youtu\.be\/.*[?&]list=)?([A-Za-z0-9_-]{10,})/);
    if (!match) { setError('Enter a valid YouTube playlist ID or a link to the playlist.'); return; }
    const playlistId = match[1];
    setLoading(true);
    setLoadingLabel('Reading playlist videos…');
    try {
      sessionStorage.setItem('playlist-index-key', keyInput.trim());
      const result = await fetchPlaylistVideos(playlistId, keyInput.trim());
      if (!result.items.length) throw new Error('This playlist is empty, or all of its videos are private or deleted.');
      setVideos(result.items.map((video, index) => ({ ...video, order: index + 1 })));
      setPlaylistName(result.playlistTitle);
      setActivePlaylistId(playlistId);
      setSelected(new Set());
      setPage(1);
      setSearch('');
      setSort({ key: 'order', direction: 'asc' });
    } catch (err) {
      setError(err.message || 'Something went wrong while loading the playlist.');
    } finally {
      setLoading(false);
      setLoadingLabel('');
    }
  };

  const toggleSort = (key) => {
    setSort((previous) => ({ key, direction: previous.key === key && previous.direction === 'asc' ? 'desc' : 'asc' }));
    setPage(1);
  };

  const toggleVideo = (id) => setSelected((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAllVisible = () => setSelected((previous) => {
    const next = new Set(previous);
    if (allVisibleSelected) pageRows.forEach((video) => next.delete(video.id));
    else pageRows.forEach((video) => next.add(video.id));
    return next;
  });

  const copyUrls = async () => {
    if (!selected.size) return;
    const urls = videos.filter((video) => selected.has(video.id)).map((video) => `https://www.youtube.com/watch?v=${video.id}`).join(', ');
    try {
      await navigator.clipboard.writeText(urls);
      setCopied(true);
      showToast(`${selected.size} video link${selected.size === 1 ? '' : 's'} copied to clipboard`);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setError('Couldn’t access the clipboard. Try opening this page over HTTPS or localhost.');
    }
  };

  const exportUrls = () => {
    if (!selected.size) return;
    const urls = videos.filter((video) => selected.has(video.id)).map((video) => `https://www.youtube.com/watch?v=${video.id}`).join('\n');
    const file = new Blob([urls], { type: 'text/plain;charset=utf-8' });
    const downloadUrl = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `playlist-urls-${activePlaylistId || 'selected'}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
    showToast(`${selected.size} video link${selected.size === 1 ? '' : 's'} exported to TXT`);
  };

  const resetPlaylist = () => { setVideos([]); setSelected(new Set()); setSearch(''); setError(''); setActivePlaylistId(''); setPlaylistName(''); };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Playlist Index home">
          <span className="brand-icon"><Play size={14} fill="currentColor" strokeWidth={2.5} /></span>
          <span className="brand-name">playlist<span>index</span></span>
          <span className="brand-tag">TOOLKIT</span>
        </a>
        <nav className="topnav"><a className="nav-item active" href="#top"><span className="nav-dot" />PLAYLIST</a><button className="nav-item nav-settings" onClick={() => setShowSettings((v) => !v)}><Settings2 size={13} /> SETTINGS</button></nav>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> YOUR PLAYLIST, ORGANIZED <span className="eyebrow-line" /></div>
            <h1>A better way to<br /><span>browse playlists.</span></h1>
            <p>Drop in a playlist. Get every video, in order.<br />Find what you’re looking for and copy links in a click.</p>
            <div className="hero-perks"><span><Check size={13} /> Every video in one place</span><i /><span><Check size={13} /> Sorted your way</span><i /><span><Check size={13} /> Links in a click</span></div>
          </div>

          <div className="video-stack" aria-hidden="true">
            <div className="stack-back stack-top"></div><div className="stack-back stack-mid"></div>
            <div className="video-card">
              <div className="video-visual visual-sunset"><div className="sun-disc" /><div className="mountain mountain-a" /><div className="mountain mountain-b" /><div className="video-visual-caption">A QUIETER KIND OF FOCUS</div></div>
              <div className="video-meta"><div className="video-mini-thumb" /><div className="video-lines"><span /><span /><small>14:32 · 1.2M views</small></div><span className="video-meta-dots">···</span></div>
            </div>
            <div className="float-badge"><span className="float-badge-icon"><Check size={12} /></span><div><b>Playlist ready</b><span>48 videos indexed</span></div><span className="float-live" /></div>
            <div className="float-order"><span>↕</span><b>↑</b><span>Sort by date</span></div>
            <div className="orb orb-a" /><div className="orb orb-b" />
          </div>
        </section>

        {showSettings && <section className="settings-card">
          <div className="settings-heading"><div className="settings-icon"><KeyRound size={15} /></div><div><h2>YouTube Data API key</h2><p>Your key is saved only in this browser session.</p></div><button className="settings-close" onClick={() => setShowSettings(false)} aria-label="Close settings"><span>×</span></button></div>
          <div className="settings-input-wrap"><input type={showKey ? 'text' : 'password'} value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="Paste your API key" autoComplete="off" /><button type="button" className="show-key" onClick={() => setShowKey((v) => !v)}>{showKey ? 'HIDE' : 'SHOW'}</button></div>
          <div className="settings-foot"><span><LockKeyhole size={12} /> Stored in this browser session only</span><button onClick={() => setShowKeyHelp((v) => !v)}><CircleHelp size={12} /> Where do I get a key?</button></div>
          {showKeyHelp && <div className="key-help">Create a project in <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console <ExternalLink size={10} /></a>, enable the YouTube Data API v3, then create an API key under <b>APIs &amp; Services → Credentials</b>. Restrict the key to the YouTube Data API and your domain if possible.</div>}
          <div className="settings-note"><ShieldCheck size={13} /> Your key is sent directly to Google’s YouTube API from this browser. It isn’t stored on a server.</div>
        </section>}

        <section className={`lookup-card ${videos.length ? 'lookup-card-loaded' : ''}`}>
          <div className="lookup-top"><div className="lookup-icon"><Video size={16} fill="currentColor" /></div><div><h2>Start with a playlist</h2><p>Public and unlisted playlists work best.</p></div><span className="lookup-step">01 <span>/ 01</span></span></div>
          <form className="lookup-form" onSubmit={handleLoad}>
            <div className="playlist-input-wrap"><label htmlFor="playlist-id">YOUTUBE PLAYLIST URL OR ID</label><div className="playlist-input-row"><span className="input-prefix"><Video size={17} /></span><input id="playlist-id" value={playlistInput} onChange={(e) => setPlaylistInput(e.target.value)} placeholder="Paste a playlist link or ID…" autoComplete="off" /><span className="input-shortcut">↵</span></div></div>
            <button type="submit" className="load-button" disabled={loading}>{loading ? <><LoaderCircle size={16} className="spin" /> LOADING…</> : <><span>Load playlist</span><span className="button-arrow">→</span></>}</button>
          </form>
          {error && <div className="error-message"><AlertCircle size={15} /><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
          {loading && <div className="loading-message"><LoaderCircle size={13} className="spin" /> {loadingLabel}</div>}
          <div className="lookup-foot"><span><ShieldCheck size={13} /> Your API key stays in this browser</span><button onClick={() => setShowSettings((v) => !v)}><Settings2 size={13} /> {keyInput ? 'API key saved' : 'API key settings'}</button></div>
        </section>

        {videos.length > 0 ? <section className="results-section">
          <div className="results-heading"><div><div className="section-kicker">THE COLLECTION</div><h2>{playlistName || 'Your playlist'}<span className="live-dot" /></h2><p className="results-subtitle">A little easier to look through.</p></div><div className="results-stats"><div><b>{videos.length}</b><span>VIDEOS FOUND</span></div><span className="stat-divider" /><div><b>{selected.size}</b><span>SELECTED</span></div></div></div>
          <div className="table-card">
            <div className="table-toolbar"><div className="table-label"><span className="table-label-mark" /><span>VIDEO LIBRARY</span><span className="table-count">{filtered.length}</span><span className="table-toolbar-divider" /><span className="table-sort-hint"><ArrowDownUp size={11} /> Click a column to sort</span></div><div className="toolbar-actions"><label className="search-box"><Search size={14} /><input placeholder="Find a video…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /><kbd>⌘ K</kbd></label><button className="refresh-button" onClick={handleLoad} disabled={loading} aria-label="Refresh playlist"><RotateCcw size={13} /></button></div></div>
            <div className="table-scroll"><table><thead><tr><th className="check-col"><button className={`select-checkbox ${allVisibleSelected ? 'checked' : ''}`} onClick={toggleAllVisible} aria-label={allVisibleSelected ? 'Deselect visible videos' : 'Select visible videos'}>{allVisibleSelected && <Check size={11} />}</button></th><th className="number-col">#</th><th className="title-col"><SortButton label="VIDEO TITLE" active={sort.key === 'title'} direction={sort.direction} onClick={() => toggleSort('title')} /></th><th className="link-col">LINK</th><th className="date-col"><SortButton label="UPLOAD DATE" active={sort.key === 'date'} direction={sort.direction} onClick={() => toggleSort('date')} /></th><th className="views-col"><SortButton label="VIEWS" active={sort.key === 'views'} direction={sort.direction} onClick={() => toggleSort('views')} /></th><th className="open-col" /></tr></thead><tbody>
              {pageRows.length ? pageRows.map((video) => <tr key={video.id} className={selected.has(video.id) ? 'row-selected' : ''}>
                <td><button className={`select-checkbox ${selected.has(video.id) ? 'checked' : ''}`} onClick={() => toggleVideo(video.id)} aria-label={`Select ${video.title}`}>{selected.has(video.id) && <Check size={11} />}</button></td>
                <td className="row-number">{String(video.order).padStart(2, '0')}</td>
                <td><div className="title-cell">{video.thumbnail ? <img className="video-thumb" src={video.thumbnail} alt="" loading="lazy" /> : <span className="video-thumb thumb-empty"><Play size={12} fill="currentColor" /></span>}<span className="video-title" title={video.title}>{video.title}</span></div></td>
                <td><a className="video-url" href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer">youtube.com/watch?v={video.id.slice(0, 7)}… <ExternalLink size={11} /></a></td>
                <td className="date-cell">{formatDate(video.date)}</td><td className="views-cell"><Eye size={12} /> {formatViews(video.views)}</td>
                <td><a className="open-link" href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer" aria-label={`Open ${video.title} on YouTube`}><ExternalLink size={13} /></a></td>
              </tr>) : <tr><td colSpan="7" className="empty-state"><Search size={18} /> No videos match “{search}”. Try another search.</td></tr>}
            </tbody></table></div>
            <div className="table-footer"><div className="selection-summary">{selected.size ? <><span className="selection-pip" /><b>{selected.size} selected</b><span className="footer-dim">· across all pages</span><button className="clear-selection" onClick={() => setSelected(new Set())}>Clear</button></> : <span className="footer-dim">Select the videos you’d like to copy.</span>}</div><div className="pagination"><span>{filtered.length ? `${(page - 1) * PER_PAGE + 1}–${Math.min(page * PER_PAGE, filtered.length)} of ${filtered.length}` : '0 videos'}</span><button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Previous page">‹</button><button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount} aria-label="Next page">›</button></div></div>
          </div>
          <div className="bottom-actions"><div className="bottom-note"><Sparkles size={13} /><span>Links are copied as a comma-separated list, ready to paste.</span></div><div className="export-actions"><button className={`copy-button ${copied ? 'copied' : ''}`} onClick={copyUrls} disabled={!selected.size}>{copied ? <><CheckCheck size={16} /><span>Copied to clipboard</span></> : <><Clipboard size={16} /><span>Copy selected links</span>{selected.size > 0 && <span className="copy-count">{selected.size}</span>}</>}</button><button className="txt-button" onClick={exportUrls} disabled={!selected.size}><FileDown size={15} /><span>Export .txt</span></button></div></div>
          <div className="data-note"><ShieldCheck size={13} /><span>Showing publicly available playlist data provided by YouTube Data API v3.</span><button onClick={resetPlaylist}><ChevronDown size={12} /> Change playlist</button></div>
        </section> : <div className="empty-prompt"><div className="empty-prompt-icon"><Clock3 size={16} /></div><div><b>A little more clarity, right this way.</b><span>Your videos, dates, and views will show up here.</span></div><span className="empty-prompt-steps">01 INPUT <i>·</i> 02 BROWSE <i>·</i> 03 COPY</span></div>}

        <footer className="site-footer"><div className="footer-brand"><span className="footer-brand-mark"><Play size={10} fill="currentColor" /></span> playlist<span>index</span></div><span className="footer-center">A SMALL TOOL FOR BIG PLAYLISTS.</span><a href="https://developers.google.com/youtube/v3" target="_blank" rel="noreferrer">POWERED BY YOUTUBE DATA API <ExternalLink size={10} /></a></footer>
      </main>
      {toast && <div className="toast"><Check size={14} /> {toast}</div>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
