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
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [view, setView]   = useState('idle'); // idle | loading | player
  const [url, setUrl]     = useState('');
  const [error, setError] = useState('');
  const [track, setTrack] = useState(null);
  const [playing, setPlaying]   = useState(false);
  const [progress, setProgress] = useState(0);
  const [curTime, setCurTime]   = useState(0);
  const [dur, setDur]           = useState(0);
  const draggingRef = useRef(false);
  const audioRef    = useRef(null);

  // Apply theme to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

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
    audio.addEventListener('play',            onPlay);
    audio.addEventListener('pause',           onPause);
    audio.addEventListener('ended',           onEnded);
    audio.addEventListener('loadedmetadata',  onMetadata);
    audio.addEventListener('timeupdate',      onTime);
    return () => {
      audio.removeEventListener('play',           onPlay);
      audio.removeEventListener('pause',          onPause);
      audio.removeEventListener('ended',          onEnded);
      audio.removeEventListener('loadedmetadata', onMetadata);
      audio.removeEventListener('timeupdate',     onTime);
    };
  }, []);

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
    const audio = audioRef.current;
    audio.paused ? audio.play() : audio.pause();
  }

  function onSeekChange(e) {
    const pct = parseFloat(e.target.value);
    setProgress(pct);
    const audio = audioRef.current;
    if (audio.duration) setCurTime((pct / 100) * audio.duration);
  }

  function onSeekCommit(e) {
    draggingRef.current = false;
    const pct = parseFloat(e.target.value);
    const audio = audioRef.current;
    if (audio.duration) audio.currentTime = (pct / 100) * audio.duration;
  }

  const seekStyle = {
    background: `linear-gradient(to right, var(--sb-fill) ${progress}%, var(--sb-track) ${progress}%)`,
  };

  const waveCount = 13;

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
        <button
          className="knob"
          onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
          title="Toggle theme"
        />
      </div>

      {/* ── Body ── */}
      <div className="radio-body">
        <div className="mesh-panel" />

        {/* ── Screen ── */}
        <div className="screen">
          <audio ref={audioRef} preload="none" />

          {/* Idle */}
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

          {/* Loading */}
          <div className={`view loading-view${view === 'loading' ? ' active' : ''}`}>
            <div className="load-ring" />
            <div className="load-label">TUNING...</div>
          </div>

          {/* Player */}
          <div className={`view${view === 'player' ? ' active' : ''}`}>
            <div className="screen-row">
              <span className="tag">Now Playing</span>
              <button className="back-btn" onClick={goBack}>← NEW</button>
            </div>
            <div className="track-name">{track?.title}</div>
            <div className="track-meta">
              {[track?.duration && fmtDur(track.duration), track?.size]
                .filter(Boolean).join(' · ')}
            </div>

            <div className={`waveform${playing ? ' playing' : ''}`}>
              {Array.from({ length: waveCount }).map((_, i) => (
                <span key={i} className="wb" />
              ))}
            </div>

            <button className="play-btn" onClick={togglePlay} aria-label="Play / Pause">
              {playing
                ? <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                : <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v14l11-7z"/></svg>
              }
            </button>

            <div className="seek-row">
              <span className="time-lbl">{fmt(curTime)}</span>
              <input
                type="range"
                className="seekbar"
                value={progress}
                min="0" max="100" step="0.05"
                style={seekStyle}
                onMouseDown={() => { draggingRef.current = true; }}
                onTouchStart={() => { draggingRef.current = true; }}
                onMouseUp={onSeekCommit}
                onTouchEnd={onSeekCommit}
                onChange={onSeekChange}
              />
              <span className="time-lbl">{fmt(dur)}</span>
            </div>

            <a
              className="dl-btn"
              href={track ? `/download/${track.filename}?title=${encodeURIComponent(track.title)}` : '#'}
            >
              ↓ DOWNLOAD MP3
            </a>
          </div>

        </div>{/* /screen */}

        <div className="mesh-panel" />
      </div>{/* /radio-body */}

      {/* ── Bottom strip ── */}
      <div className="radio-bottom">
        <span className="brand">A T Radio Broadcast</span>
      </div>

    </div>
  );
}
