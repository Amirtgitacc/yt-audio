'use strict';

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const AUDIO_DIR = path.join(__dirname, 'audio');

// Use local binary downloaded during Railway build, fall back to system yt-dlp
const LOCAL_YTDLP = path.join(__dirname, 'yt-dlp');
const YTDLP = fs.existsSync(LOCAL_YTDLP) ? LOCAL_YTDLP : 'yt-dlp';

fs.mkdirSync(AUDIO_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

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
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        let msg = 'Extraction failed';
        if (stderr.includes('Private video')) msg = 'This video is private';
        else if (stderr.includes('age-restricted')) msg = 'This video is age-restricted';
        else if (stderr.includes('not available in your country')) msg = 'This video is not available in your region';
        else if (stderr.includes('Video unavailable')) msg = 'This video is unavailable';
        else if (stderr.includes('has been removed')) msg = 'This video has been removed';
        else if (stderr.includes('copyright')) msg = 'This video is blocked due to copyright';
        reject(new Error(msg));
      }
    });

    proc.on('error', err => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new Error('yt-dlp binary not found. Please check your installation.'));
      } else {
        reject(err);
      }
    });
  });
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

app.post('/api/extract', async (req, res) => {
  const url = (typeof req.body.url === 'string' ? req.body.url : '').trim();

  if (!url) return res.status(400).json({ error: 'URL is required' });
  if (!isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Please enter a valid YouTube URL' });
  }

  try {
    // Fetch metadata (fast path, no download)
    const info = await runYtDlp(
      ['--print', '%(id)s\n%(title)s\n%(duration)s', '--skip-download', '--no-playlist', url],
      30_000
    );

    const lines = info.split('\n');
    const id = (lines[0] || '').trim();
    const title = (lines[1] || 'Unknown Title').trim();
    const duration = parseInt(lines[2] || '0', 10) || 0;

    if (!id || !/^[\w-]+$/.test(id)) {
      throw new Error('Could not determine video ID');
    }

    const filename = `${id}.mp3`;
    const filepath = path.join(AUDIO_DIR, filename);

    // Extract only if not already cached
    if (!fs.existsSync(filepath)) {
      await runYtDlp([
        '-x', '--audio-format', 'mp3', '--audio-quality', '0',
        '--no-playlist', '--no-part',
        '-o', path.join(AUDIO_DIR, '%(id)s.%(ext)s'),
        url,
      ]);
    }

    if (!fs.existsSync(filepath)) {
      throw new Error('Audio file was not created — the video may be restricted');
    }

    const { size } = fs.statSync(filepath);

    res.json({
      title,
      duration,
      size: formatBytes(size),
      filename,
      audioUrl: `/audio/${filename}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong. Please try again.' });
  }
});

// Stream audio with HTTP range support
app.get('/audio/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!/^[\w-]+\.mp3$/.test(filename)) return res.status(400).end();
  const filepath = path.join(AUDIO_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).end();
  res.sendFile(filepath);
});

// Download with proper filename
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
