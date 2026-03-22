'use strict';

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const AUDIO_DIR = path.join(__dirname, 'audio');

// Find yt-dlp binary — checks multiple locations
const { execSync } = require('child_process');
function findYtDlp() {
  const candidates = [
    path.join(__dirname, 'yt-dlp'),
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  try { return execSync('which yt-dlp').toString().trim(); } catch {}
  return 'yt-dlp';
}
const YTDLP = findYtDlp();
console.log(`yt-dlp: ${YTDLP}`);

fs.mkdirSync(AUDIO_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

// ── In-memory job store for SSE progress ─────────────────────────
const jobs = new Map();
let jobCounter = 0;

function isValidYouTubeUrl(url) {
  try {
    const { hostname, searchParams, pathname } = new URL(url);
    const validHosts = [
      'youtube.com', 'www.youtube.com', 'youtu.be',
      'm.youtube.com', 'music.youtube.com',
    ];
    if (!validHosts.includes(hostname)) return false;
    if (hostname === 'youtu.be') return pathname.length > 1;
    return (
      searchParams.has('v') ||
      pathname.startsWith('/shorts/') ||
      pathname.startsWith('/embed/')
    );
  } catch {
    return false;
  }
}

function parseYtDlpError(stderr) {
  if (stderr.includes('Private video')) return 'This video is private';
  if (stderr.includes('age-restricted')) return 'This video is age-restricted';
  if (stderr.includes('not available in your country')) return 'This video is not available in your region';
  if (stderr.includes('Video unavailable')) return 'This video is unavailable';
  if (stderr.includes('has been removed')) return 'This video has been removed';
  if (stderr.includes('copyright')) return 'This video is blocked due to copyright';
  return 'Extraction failed';
}

// Runs yt-dlp and returns stdout (for metadata fetching)
function runYtDlp(args, timeoutMs = 300_000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, args);
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('Extraction timed out after 5 minutes'));
    }, timeoutMs);

    proc.stdout.on('data', d => (stdout += d.toString()));
    proc.stderr.on('data', d => (stderr += d.toString()));

    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(parseYtDlpError(stderr)));
    });

    proc.on('error', err => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') reject(new Error('yt-dlp binary not found. Please check your installation.'));
      else reject(err);
    });
  });
}

// Runs yt-dlp download and streams progress % into the job object
function runYtDlpWithProgress(args, jobId, timeoutMs = 300_000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, args);
    let stderr = '';

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('Extraction timed out after 5 minutes'));
    }, timeoutMs);

    proc.stderr.on('data', d => {
      const chunk = d.toString();
      stderr += chunk;
      // Parse lines like: [download]  45.2% of 8.32MiB at 1.23MiB/s ETA 00:05
      const matches = [...chunk.matchAll(/\[download\]\s+([\d.]+)%/g)];
      if (matches.length > 0) {
        const pct = parseFloat(matches[matches.length - 1][1]);
        const job = jobs.get(jobId);
        if (job && pct > (job.progress || 0)) job.progress = pct;
      }
    });

    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(parseYtDlpError(stderr)));
    });

    proc.on('error', err => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') reject(new Error('yt-dlp binary not found. Please check your installation.'));
      else reject(err);
    });
  });
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Extract endpoint ──────────────────────────────────────────────
app.post('/api/extract', async (req, res) => {
  const url = (typeof req.body.url === 'string' ? req.body.url : '').trim();

  if (!url) return res.status(400).json({ error: 'URL is required' });
  if (!isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Please enter a valid YouTube URL' });
  }

  try {
    // Fetch metadata quickly (no download)
    const info = await runYtDlp(
      ['--print', '%(id)s\n%(title)s\n%(duration)s', '--skip-download', '--no-playlist', url],
      30_000
    );

    const lines = info.split('\n');
    const id       = (lines[0] || '').trim();
    const title    = (lines[1] || 'Unknown Title').trim();
    const duration = parseInt(lines[2] || '0', 10) || 0;

    if (!id || !/^[\w-]+$/.test(id)) throw new Error('Could not determine video ID');

    const filename = `${id}.mp3`;
    const filepath = path.join(AUDIO_DIR, filename);

    // Already cached — return immediately
    if (fs.existsSync(filepath)) {
      const { size } = fs.statSync(filepath);
      return res.json({
        title, duration, filename,
        size: formatBytes(size),
        audioUrl: `/audio/${filename}`,
        cached: true,
      });
    }

    // Create a background job and return jobId to the client
    const jobId = `j${++jobCounter}`;
    jobs.set(jobId, { status: 'downloading', progress: 0 });

    res.json({ title, duration, filename, jobId });

    // Download in background
    runYtDlpWithProgress([
      '-x', '--audio-format', 'mp3', '--audio-quality', '0',
      '--no-playlist', '--no-part',
      '-o', path.join(AUDIO_DIR, '%(id)s.%(ext)s'),
      url,
    ], jobId).then(() => {
      const job = jobs.get(jobId);
      if (!job) return;
      if (fs.existsSync(filepath)) {
        const { size } = fs.statSync(filepath);
        job.status   = 'done';
        job.size     = formatBytes(size);
        job.audioUrl = `/audio/${filename}`;
      } else {
        job.status = 'error';
        job.error  = 'Audio file was not created — the video may be restricted';
      }
      setTimeout(() => jobs.delete(jobId), 600_000);
    }).catch(err => {
      const job = jobs.get(jobId);
      if (job) {
        job.status = 'error';
        job.error  = err.message;
        setTimeout(() => jobs.delete(jobId), 600_000);
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong. Please try again.' });
  }
});

// ── SSE progress endpoint ─────────────────────────────────────────
app.get('/api/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  if (!/^j\d+$/.test(jobId)) return res.status(400).end();

  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
  });

  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Already finished before client connected
  if (job.status === 'done') {
    send({ type: 'done', audioUrl: job.audioUrl, size: job.size });
    return res.end();
  }
  if (job.status === 'error') {
    send({ type: 'error', message: job.error });
    return res.end();
  }

  // Poll until done
  const iv = setInterval(() => {
    const j = jobs.get(jobId);
    if (!j) { clearInterval(iv); res.end(); return; }

    if (j.status === 'downloading') {
      send({ type: 'progress', percent: j.progress });
    } else if (j.status === 'done') {
      send({ type: 'done', audioUrl: j.audioUrl, size: j.size });
      clearInterval(iv);
      res.end();
    } else if (j.status === 'error') {
      send({ type: 'error', message: j.error });
      clearInterval(iv);
      res.end();
    }
  }, 400);

  req.on('close', () => clearInterval(iv));
});

// ── Audio streaming (range support) ──────────────────────────────
app.get('/audio/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!/^[\w-]+\.mp3$/.test(filename)) return res.status(400).end();
  const filepath = path.join(AUDIO_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).end();
  res.sendFile(filepath);
});

// ── Download with proper filename ─────────────────────────────────
app.get('/download/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!/^[\w-]+\.mp3$/.test(filename)) return res.status(400).end();
  const filepath = path.join(AUDIO_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).end();
  const rawTitle = typeof req.query.title === 'string' ? req.query.title : '';
  const safeTitle = rawTitle.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 200);
  const downloadName = safeTitle ? `${safeTitle}.mp3` : filename;
  res.download(filepath, downloadName);
});

app.listen(PORT, () => {
  console.log(`\n  YT Audio Extractor`);
  console.log(`  Running at http://localhost:${PORT}\n`);
});
