import { useState, useEffect, useRef } from 'react';

function fmt(s) {
  if (!isFinite(s) || isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function fmtDur(s) {
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sc = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${sc}s` : `${sc}s`;
}

export default function App() {
  const [view, setView]               = useState('idle');
  const [url, setUrl]                 = useState('');
  const [error, setError]             = useState('');
  const [track, setTrack]             = useState(null);
  const [playing, setPlaying]         = useState(false);
  const [progress, setProgress]       = useState(0);
  const [curTime, setCurTime]         = useState(0);
  const [dur, setDur]                 = useState(0);
  const [looping, setLooping]         = useState(false);
  const [volume, setVolume]           = useState(1);
  const [downloading, setDownloading] = useState(false);

  const draggingRef = useRef(false);
  const audioRef    = useRef(null);
  const dlTimerRef  = useRef(null);

  // Status light: red=loading, blink=downloading, green=everything else
  const statusClass = view === 'loading' ? 'red' : downloading ? 'blink' : 'green';

  // Audio event listeners
  useEffect(() => {
    const audio = audioRef.current;
    const onPlay     = () => setPlaying(true);
    const onPause    = () => setPlaying(false);
    const onEnded    = () => { setPlaying(false); setProgress(0); setCurTime(0); };
    const onMetadata = () => setDur(audio.duration);
    const onTime     = () => {
      if (draggingRef.current || !audio.duration) return;
      setProgress((audio.currentTime / audio.duration) * 100);
      setCurTime(audio.currentTime);
      setDur(audio.duration);
    };
    audio.addEventListener('play',           onPlay);
    audio.addEventListener('pause',          onPause);
    audio.addEventListener('ended',          onEnded);
    audio.addEventListener('loadedmetadata', onMetadata);
    audio.addEventListener('timeupdate',     onTime);
    return () => {
      audio.removeEventListener('play',           onPlay);
      audio.removeEventListener('pause',          onPause);
      audio.removeEventListener('ended',          onEnded);
      audio.removeEventListener('loadedmetadata', onMetadata);
      audio.removeEventListener('timeupdate',     onTime);
    };
  }, []);

  // Sync volume & loop to audio element
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);
  useEffect(() => { if (audioRef.current) audioRef.current.loop   = looping; }, [looping]);

  // ── Handlers ────────────────────────────────────────────────────
  async function extract() {
    if (!url.trim()) { setError('ENTER A YOUTUBE URL'); return; }
    setError('');
    const audio = audioRef.current;
    audio.pause(); audio.src = '';
    setPlaying(false); setProgress(0); setCurTime(0); setDur(0);
    setView('loading');

    try {
      const res  = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'EXTRACTION FAILED');
      setTrack(data);
      audio.src = data.audioUrl;
      setView('player');
    } catch (err) {
      setError(err.message.toUpperCase());
      setView('idle');
    }
  }

  function goBack() {
    const audio = audioRef.current;
    audio.pause(); audio.src = '';
    setPlaying(false); setProgress(0); setCurTime(0); setDur(0);
    setView('idle');
  }

  function togglePlay() {
    const a = audioRef.current;
    a.paused ? a.play() : a.pause();
  }

  function skip(seconds) {
    const a = audioRef.current;
    if (!a.duration) return;
    a.currentTime = Math.max(0, Math.min(a.duration, a.currentTime + seconds));
  }

  function toggleLoop() {
    setLooping(l => !l);
  }

  function handleDownload() {
    setDownloading(true);
    clearTimeout(dlTimerRef.current);
    dlTimerRef.current = setTimeout(() => setDownloading(false), 3000);
  }

  function onSeekChange(e) {
    const pct = parseFloat(e.target.value);
    setProgress(pct);
    const a = audioRef.current;
    if (a.duration) setCurTime((pct / 100) * a.duration);
  }

  function onSeekCommit(e) {
    draggingRef.current = false;
    const a = audioRef.current;
    if (a.duration) a.currentTime = (parseFloat(e.target.value) / 100) * a.duration;
  }

  const seekStyle   = { background: `linear-gradient(to right, var(--sb-fill) ${progress}%, var(--sb-track) ${progress}%)` };
  const volumeStyle = { background: `linear-gradient(to right, var(--sb-fill) ${volume * 100}%, var(--sb-track) ${volume * 100}%)` };

  return (
    <div className="radio">

      {/* ── Top bar ── */}
      <div className="radio-top">
        <div className="indicator-dots">
          <span className="dot dot-r" />
          <span className="dot dot-y" />
          <span className="dot dot-g" />
        </div>
        <div className="top-mesh" />
        {/* Status indicator light */}
        <div className={`status-light ${statusClass}`} />
      </div>

      {/* ── Body ── */}
      <div className="radio-body">
        <div className="mesh-panel" />

        {/* ── Screen ── */}
        <div className="screen">
          <audio ref={audioRef} preload="none" />

          {/* Idle view */}
          <div className={`view${view === 'idle' ? ' active' : ''}`}>
            <div className="screen-row">
              <span className="tag">YT Audio Extractor</span>
            </div>
            <input
              type="url"
              className="screen-input"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && extract()}
              placeholder="Paste YouTube URL..."
              autoComplete="off"
              spellCheck={false}
            />
            <button className="tune-btn" onClick={extract}>
              <span className="btn-text">TUNE IN</span>
            </button>
            {error && <div className="error-line">{error}</div>}
            <p className="hint-text">ENTER URL AND PRESS TUNE IN</p>
          </div>

          {/* Loading view */}
          <div className={`view loading-view${view === 'loading' ? ' active' : ''}`}>
            <div className="load-ring" />
            <div className="load-label">TUNING...</div>
          </div>

          {/* Player view */}
          <div className={`view${view === 'player' ? ' active' : ''}`}>
            <div className="screen-row">
              <span className="tag">Now Playing</span>
              <button className="back-btn" onClick={goBack}>← NEW</button>
            </div>

            <div className="track-name">{track?.title}</div>
            <div className="track-meta">
              {[track?.duration && fmtDur(track.duration), track?.size].filter(Boolean).join(' · ')}
            </div>

            <div className={`waveform${playing ? ' playing' : ''}`}>
              {Array.from({ length: 13 }).map((_, i) => <span key={i} className="wb" />)}
            </div>

            {/* Controls: loop · −10 · play · +10 */}
            <div className="controls-row">
              <button
                className={`loop-btn${looping ? ' active' : ''}`}
                onClick={toggleLoop}
                title="Toggle loop"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="17 1 21 5 17 9"/>
                  <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                  <polyline points="7 23 3 19 7 15"/>
                  <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                </svg>
              </button>

              <button className="skip-btn" onClick={() => skip(-10)} title="Back 10s">
                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                  <path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                </svg>
                <span className="skip-num">10</span>
              </button>

              <button className="play-btn" onClick={togglePlay} aria-label="Play / Pause">
                {playing
                  ? <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                  : <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v14l11-7z"/></svg>
                }
              </button>

              <button className="skip-btn" onClick={() => skip(10)} title="Forward 10s">
                <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                  <path d="M12.01 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/>
                </svg>
                <span className="skip-num">10</span>
              </button>
            </div>

            {/* Progress bar */}
            <div className="seek-row">
              <span className="time-lbl">{fmt(curTime)}</span>
              <input
                type="range" className="seekbar"
                value={progress} min="0" max="100" step="0.05"
                style={seekStyle}
                onMouseDown={() => { draggingRef.current = true; }}
                onTouchStart={() => { draggingRef.current = true; }}
                onMouseUp={onSeekCommit}
                onTouchEnd={onSeekCommit}
                onChange={onSeekChange}
              />
              <span className="time-lbl">{fmt(dur)}</span>
            </div>

            {/* Volume */}
            <div className="volume-row">
              <svg className="vol-icon" viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
                <path d="M3 9v6h4l5 5V4L7 9H3z"/>
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
              </svg>
              <input
                type="range" className="volume-slider"
                value={volume} min="0" max="1" step="0.01"
                style={volumeStyle}
                onChange={e => setVolume(parseFloat(e.target.value))}
              />
            </div>

            {/* Download */}
            <a
              className="dl-btn"
              href={track ? `/download/${track.filename}?title=${encodeURIComponent(track.title)}` : '#'}
              onClick={handleDownload}
            >
              ↓ DOWNLOAD MP3
            </a>
          </div>

        </div>{/* /screen */}
        <div className="mesh-panel" />
      </div>

      <div className="radio-bottom">
        <span className="brand">A T Radio Broadcast</span>
      </div>

    </div>
  );
}
