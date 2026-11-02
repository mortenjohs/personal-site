/**
 * Solar System Asteroids Interactive Web Engine & Video Recorder.
 * Real-time Keplerian orbital propagator for 20,000+ celestial bodies.
 */

let dataset = null;
let canvas, ctx;
let isPlaying = true;
let currentYear = 2026.56; // Default to present day July 2026
let speedDaysPerSec = 30.0;
let lastTime = 0;

// Camera & View Parameters
let scale = 12; // pixels per AU
let panX = 0;
let panY = 0;
let isDragging = false;
let startDragX = 0, startDragY = 0;

let centerRefPlanet = 'Sol';
let coRefPlanet = 'Sol';

function getFrameState(year) {
  let cx = 0.0, cy = 0.0;
  if (centerRefPlanet && centerRefPlanet !== 'Sol' && centerRefPlanet !== 'none' && dataset && dataset.planets) {
    const cPlanet = dataset.planets.find(p => p.name.toLowerCase() === centerRefPlanet.toLowerCase());
    if (cPlanet) {
      const cPos = computeBodyPosition(cPlanet, year, null);
      cx = cPos.x;
      cy = cPos.y;
    }
  }

  let rx = 0.0, ry = 0.0;
  if (coRefPlanet && coRefPlanet !== 'Sol' && coRefPlanet !== 'none' && dataset && dataset.planets) {
    const rPlanet = dataset.planets.find(p => p.name.toLowerCase() === coRefPlanet.toLowerCase());
    if (rPlanet) {
      const rPos = computeBodyPosition(rPlanet, year, null);
      rx = rPos.x;
      ry = rPos.y;
    }
  }

  let corotAngle = 0.0;
  if (centerRefPlanet !== coRefPlanet) {
    const vx = rx - cx;
    const vy = ry - cy;
    if (vx !== 0.0 || vy !== 0.0) {
      corotAngle = -Math.atan2(vy, vx);
    }
  }

  return { cx, cy, corotAngle };
}
let activePopulations = new Set();
let asteroidSize = 1.4;
let asteroidOpacity = 0.7;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

// Selection & Trail State
let selectedBody = null;
let trailPoints = [];
let maxTrailLength = 300;
let mouseClickStart = { x: 0, y: 0 };

// Epoch J2000
const J2000_EPOCH = 2000.0;

// Vectorized Kepler Solver in JS
function solveKepler(M, e) {
  let E = M + e * Math.sin(M);
  for (let iter = 0; iter < 7; iter++) {
    const f = E - e * Math.sin(E) - M;
    const fPrime = 1.0 - e * Math.cos(E);
    const delta = f / fPrime;
    E -= delta;
    if (Math.abs(delta) < 1e-6) break;
  }
  return E;
}

// Compute 2D (x, y) coordinates in AU at time t
function computeBodyPosition(body, year, corotAngleRad = 0.0) {
  const refEpoch = body.epoch_year !== undefined ? body.epoch_year : J2000_EPOCH;
  const dt = year - refEpoch;
  const a = body.a;
  const e = body.e;
  const iRad = (body.i * Math.PI) / 180.0;
  const OmRad = (body.Omega * Math.PI) / 180.0;
  const omRad = (body.omega * Math.PI) / 180.0;
  const M0Rad = (body.M0 * Math.PI) / 180.0;

  // Mean motion n = 2*pi / a^1.5
  let n = (2.0 * Math.PI) / Math.pow(a, 1.5);
  
  // Resonant Mean Motion locking for co-orbitals / Trojans / Hildas
  if (body.pop) {
    if (body.pop.includes('Jupiter Trojans') || body.pop.includes('Trojans L')) {
      n = (2.0 * Math.PI) / Math.pow(5.202603, 1.5);
    } else if (body.pop === 'Neptune Trojans') {
      n = (2.0 * Math.PI) / Math.pow(30.110387, 1.5);
    } else if (body.pop === 'Hildas') {
      n = 1.5 * ((2.0 * Math.PI) / Math.pow(5.202603, 1.5));
    }
  }

  let M = (M0Rad + n * dt) % (2.0 * Math.PI);

  if (body.lib_amp) {
    const libAmpRad = (body.lib_amp * Math.PI) / 180.0;
    const libPeriod = body.lib_period || 150.0;
    const libOmega = (2.0 * Math.PI) / libPeriod;
    const tadpoleOsc = libAmpRad * Math.sin(libOmega * dt + (body.lib_phase || 0));
    M = (M + tadpoleOsc) % (2.0 * Math.PI);
  }

  const E = solveKepler(M, e);

  // Orbital plane
  const xOrb = a * (Math.cos(E) - e);
  const yOrb = a * Math.sqrt(1.0 - e * e) * Math.sin(E);

  // 3D rotation matrix
  const cosOm = Math.cos(OmRad), sinOm = Math.sin(OmRad);
  const cosom = Math.cos(omRad), sinom = Math.sin(omRad);
  const cosi = Math.cos(iRad);

  const Px = cosom * cosOm - sinom * sinOm * cosi;
  const Py = cosom * sinOm + sinom * cosOm * cosi;
  const Qx = -sinom * cosOm - cosom * sinOm * cosi;
  const Qy = -sinom * sinOm + cosom * cosOm * cosi;

  let x = xOrb * Px + yOrb * Qx;
  let y = xOrb * Py + yOrb * Qy;

  if (corotAngleRad) {
    if (typeof corotAngleRad === 'number') {
      if (corotAngleRad !== 0.0) {
        const c = Math.cos(corotAngleRad);
        const s = Math.sin(corotAngleRad);
        const xr = x * c - y * s;
        const yr = x * s + y * c;
        x = xr; y = yr;
      }
    } else {
      const cx = corotAngleRad.cx || 0.0;
      const cy = corotAngleRad.cy || 0.0;
      const angle = corotAngleRad.corotAngle || 0.0;
      x -= cx;
      y -= cy;
      if (angle !== 0.0) {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const xr = x * c - y * s;
        const yr = x * s + y * c;
        x = xr; y = yr;
      }
    }
  }

  return { x, y };
}

// Convert AU coordinates to screen pixels
function auToScreen(x, y) {
  const cx = canvas.width / 2 + panX;
  const cy = canvas.height / 2 + panY;
  return {
    sx: cx + x * scale,
    sy: cy - y * scale // Flip y-axis for screen coords
  };
}

// Convert screen pixels to AU coordinates
function screenToAu(sx, sy) {
  const cx = canvas.width / 2 + panX;
  const cy = canvas.height / 2 + panY;
  return {
    x: (sx - cx) / scale,
    y: (cy - sy) / -scale
  };
}

// Initialize Application
async function initApp() {
  canvas = document.getElementById('orbit-canvas');
  ctx = canvas.getContext('2d');

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  try {
    const res = await fetch('public/solar_system_asteroids.json');
    dataset = await res.json();
    console.log(`[WebEngine] Dataset loaded: ${dataset.asteroids.length} asteroids.`);
  } catch (err) {
    console.warn('Fallback: loading local dataset inline');
    // Default fallback if fetch fails
  }

  setupUI();
  setupInteractions();

  // Set default view preset
  applyPreset('full');

  requestAnimationFrame(animationLoop);
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

// Setup Filters & Event Handlers
function setupUI() {
  if (!dataset) return;

  const filtersGrid = document.getElementById('population-filters');
  filtersGrid.innerHTML = '';

  const popCounts = {};
  dataset.asteroids.forEach(ast => {
    popCounts[ast.pop] = (popCounts[ast.pop] || 0) + 1;
    activePopulations.add(ast.pop);
  });

  Object.entries(dataset.population_colors).forEach(([pop, color]) => {
    const count = popCounts[pop] || 0;
    const item = document.createElement('div');
    item.className = 'filter-item';
    item.innerHTML = `
      <div class="filter-left">
        <input type="checkbox" id="pop-${pop}" checked>
        <span class="color-dot" style="background-color: ${color}"></span>
        <span>${pop}</span>
      </div>
      <span class="count-badge">${count}</span>
    `;

    item.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) activePopulations.add(pop);
      else activePopulations.delete(pop);
    });

    filtersGrid.appendChild(item);
  });
}

function applyPreset(preset) {
  const minDim = Math.min(canvas.width, canvas.height);
  if (preset === 'inner') {
    scale = minDim / 13.0; // ~6 AU radius
  } else if (preset === 'outer') {
    scale = minDim / 75.0; // ~35 AU radius
  } else if (preset === 'full') {
    scale = minDim / 115.0; // ~55 AU radius
  }
  panX = 0;
  panY = 0;

  document.querySelectorAll('.btn-preset').forEach(b => {
    b.classList.toggle('active', b.dataset.preset === preset);
  });
}

function setupInteractions() {
  // Preset buttons
  document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  });

  // Center Ref select dropdown
  const centerSelect = document.getElementById('select-center-ref');
  if (centerSelect) {
    centerSelect.addEventListener('change', (e) => {
      centerRefPlanet = e.target.value;
      trailPoints = [];
    });
  }

  // Co-Ref select dropdown
  const coSelect = document.getElementById('select-co-ref');
  if (coSelect) {
    coSelect.addEventListener('change', (e) => {
      coRefPlanet = e.target.value;
      trailPoints = [];
    });
  }

  // Asteroid Size Slider
  const sizeSlider = document.getElementById('slider-asteroid-size');
  const sizeValText = document.getElementById('size-val');
  if (sizeSlider) {
    sizeSlider.addEventListener('input', (e) => {
      asteroidSize = parseFloat(e.target.value);
      sizeValText.textContent = `${asteroidSize.toFixed(1)} px`;
    });
  }

  // Asteroid Opacity Slider
  const opacitySlider = document.getElementById('slider-asteroid-opacity');
  const opacityValText = document.getElementById('opacity-val');
  if (opacitySlider) {
    opacitySlider.addEventListener('input', (e) => {
      const opacityPct = parseInt(e.target.value, 10);
      asteroidOpacity = opacityPct / 100.0;
      opacityValText.textContent = `${opacityPct}%`;
    });
  }

  // Controls
  const playBtn = document.getElementById('btn-play-pause');
  playBtn.addEventListener('click', () => {
    isPlaying = !isPlaying;
    playBtn.textContent = isPlaying ? '⏸' : '▶';
  });

  const timelineSlider = document.getElementById('timeline-slider');
  timelineSlider.addEventListener('input', (e) => {
    currentYear = parseFloat(e.target.value);
  });

  const speedSlider = document.getElementById('speed-slider');
  const speedVal = document.getElementById('speed-val');
  speedSlider.addEventListener('input', (e) => {
    speedDaysPerSec = parseFloat(e.target.value);
    if (speedDaysPerSec >= 365) {
      speedVal.textContent = `${(speedDaysPerSec / 365.25).toFixed(1)} yr/s`;
    } else {
      speedVal.textContent = `${speedDaysPerSec.toFixed(0)} d/s`;
    }
  });

  document.getElementById('btn-reset-cam').addEventListener('click', () => {
    panX = 0;
    panY = 0;
  });

  // Trail Length Slider
  const trailLenSlider = document.getElementById('slider-trail-length');
  const trailLenValText = document.getElementById('trail-len-val');
  if (trailLenSlider) {
    trailLenSlider.addEventListener('input', (e) => {
      maxTrailLength = parseInt(e.target.value, 10);
      trailLenValText.textContent = `${maxTrailLength} pts`;
      // Trim trail points if needed
      while (trailPoints.length > maxTrailLength) {
        trailPoints.shift();
      }
    });
  }

  // Search & Autocomplete
  setupSearchAndPicker();

  // Info box close
  const infoCloseBtn = document.getElementById('info-close');
  if (infoCloseBtn) {
    infoCloseBtn.addEventListener('click', () => selectBody(null));
  }

  // Canvas Mouse Picking & Dragging
  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    startDragX = e.clientX - panX;
    startDragY = e.clientY - panY;
    mouseClickStart = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener('mousemove', (e) => {
    if (isDragging) {
      panX = e.clientX - startDragX;
      panY = e.clientY - startDragY;
    }
  });

  window.addEventListener('mouseup', (e) => {
    isDragging = false;
    // Check if mouse moved very little => Click event for body picking!
    const distMoved = Math.hypot(e.clientX - mouseClickStart.x, e.clientY - mouseClickStart.y);
    if (distMoved < 4) {
      pickBodyAtScreenPos(e.clientX, e.clientY);
    }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    scale *= zoomFactor;
  }, { passive: false });

  // Video Recorder
  const recBtn = document.getElementById('btn-record');
  recBtn.addEventListener('click', toggleVideoRecording);
}

// MediaRecorder Video Export
function toggleVideoRecording() {
  const recBtn = document.getElementById('btn-record');
  if (!isRecording) {
    recordedChunks = [];
    const stream = canvas.captureStream(30); // 30 fps
    try {
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    } catch (e) {
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    }

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `solar_system_asteroids_${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    };

    mediaRecorder.start();
    isRecording = true;
    recBtn.classList.add('recording');
    recBtn.innerHTML = '<span class="rec-dot"></span> Stop Recording';
  } else {
    mediaRecorder.stop();
    isRecording = false;
    recBtn.classList.remove('recording');
    recBtn.innerHTML = '<span class="rec-dot"></span> Record Video (WebM/MP4)';
  }
}

function selectBody(body) {
  selectedBody = body;
  trailPoints = [];
  updateInfoBox();
}

function updateInfoBox() {
  const box = document.getElementById('info-box');
  if (!selectedBody) {
    box.classList.add('hidden');
    return;
  }

  box.classList.remove('hidden');
  document.getElementById('info-name').textContent = selectedBody.name || selectedBody.id || 'Selected Body';
  document.getElementById('info-type').textContent = selectedBody.pop || (selectedBody.radius_kms ? 'Planet' : 'Asteroid');
  document.getElementById('info-a').textContent = `${parseFloat(selectedBody.a).toFixed(3)} AU`;
  document.getElementById('info-e').textContent = `${parseFloat(selectedBody.e).toFixed(3)}`;
  document.getElementById('info-i').textContent = `${parseFloat(selectedBody.i).toFixed(2)}°`;

  const periodYrs = Math.pow(selectedBody.a, 1.5).toFixed(2);
  document.getElementById('info-period').textContent = `${periodYrs} yrs`;
}

function pickBodyAtScreenPos(screenX, screenY) {
  if (!dataset) return;

  const frameState = getFrameState(currentYear);

  let closest = null;
  let minDistanceSq = 16 * 16; // 16px radius threshold

  // 1. Check Planets
  dataset.planets.forEach(p => {
    const pos = computeBodyPosition(p, currentYear, frameState);
    const scr = auToScreen(pos.x, pos.y);
    const distSq = Math.pow(scr.sx - screenX, 2) + Math.pow(scr.sy - screenY, 2);
    if (distSq < minDistanceSq) {
      minDistanceSq = distSq;
      closest = p;
    }
  });

  // 2. Check Named Asteroids
  if (dataset.named_asteroids) {
    dataset.named_asteroids.forEach(ast => {
      const pos = computeBodyPosition(ast, currentYear, frameState);
      const scr = auToScreen(pos.x, pos.y);
      const distSq = Math.pow(scr.sx - screenX, 2) + Math.pow(scr.sy - screenY, 2);
      if (distSq < minDistanceSq) {
        minDistanceSq = distSq;
        closest = ast;
      }
    });
  }

  // 3. Check Swarm Asteroids
  dataset.asteroids.forEach(ast => {
    if (!activePopulations.has(ast.pop)) return;
    const pos = computeBodyPosition(ast, currentYear, frameState);
    const scr = auToScreen(pos.x, pos.y);
    const distSq = Math.pow(scr.sx - screenX, 2) + Math.pow(scr.sy - screenY, 2);
    if (distSq < minDistanceSq) {
      minDistanceSq = distSq;
      closest = ast;
    }
  });

  selectBody(closest);
}

function setupSearchAndPicker() {
  const input = document.getElementById('input-search-body');
  const dropdown = document.getElementById('search-results');

  if (!input || !dropdown) return;

  input.addEventListener('input', (e) => {
    const query = e.target.value.trim().toLowerCase();
    if (!query || !dataset) {
      dropdown.classList.add('hidden');
      return;
    }

    const matches = [];

    // Search Planets
    dataset.planets.forEach(p => {
      if (p.name.toLowerCase().includes(query)) matches.push(p);
    });

    // Search Named Asteroids
    if (dataset.named_asteroids) {
      dataset.named_asteroids.forEach(ast => {
        if (ast.name.toLowerCase().includes(query)) matches.push(ast);
      });
    }

    // Search Swarm Asteroids (up to 10)
    dataset.asteroids.forEach(ast => {
      if (matches.length >= 15) return;
      const name = ast.name || ast.id || '';
      if (name.toLowerCase().includes(query)) matches.push(ast);
    });

    dropdown.innerHTML = '';
    if (matches.length === 0) {
      dropdown.classList.add('hidden');
      return;
    }

    matches.forEach(item => {
      const div = document.createElement('div');
      div.className = 'search-item';
      div.innerHTML = `<span>${item.name || item.id}</span> <span class="count-badge">${item.pop || 'Planet'}</span>`;
      div.addEventListener('click', () => {
        selectBody(item);
        input.value = item.name || item.id;
        dropdown.classList.add('hidden');
      });
      dropdown.appendChild(div);
    });

    dropdown.classList.remove('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });
}

// Main Render Loop
function animationLoop(timestamp) {
  if (!lastTime) lastTime = timestamp;
  const deltaTimeSec = (timestamp - lastTime) / 1000.0;
  lastTime = timestamp;

  if (isPlaying) {
    const daysAdvance = speedDaysPerSec * deltaTimeSec;
    currentYear += daysAdvance / 365.25;
    document.getElementById('timeline-slider').value = currentYear;
  }

  // Record Motion Trail for Selected Body
  if (selectedBody) {
    const frameState = getFrameState(currentYear);
    const currentPos = computeBodyPosition(selectedBody, currentYear, frameState);
    trailPoints.push({ x: currentPos.x, y: currentPos.y, year: currentYear });

    while (trailPoints.length > maxTrailLength) {
      trailPoints.shift();
    }
  }

  // Update HUD date
  const yearInt = Math.floor(currentYear);
  const monthInt = Math.floor((currentYear - yearInt) * 12) + 1;
  const dayInt = Math.floor(((currentYear - yearInt) * 12 - (monthInt - 1)) * 30) + 1;
  document.getElementById('hud-date-display').textContent = `${yearInt}-${String(monthInt).padStart(2,'0')}-${String(dayInt).padStart(2,'0')}`;
  document.getElementById('hud-time-details').textContent = `T+${((currentYear - 2026.56)*365.25).toFixed(0)} Days • Year ${currentYear.toFixed(2)}`;

  // Render Frame
  renderCanvas();

  requestAnimationFrame(animationLoop);
}

function renderCanvas() {
  ctx.fillStyle = '#07080C';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!dataset) return;

  // Calculate Frame State (Center & Co-Reference)
  const frameState = getFrameState(currentYear);

  // 1. Draw Distance Scale Rings
  const rings = [1.0, 2.7, 5.2, 9.5, 19.2, 30.1, 45.0];
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  rings.forEach(r => {
    const screenRadius = r * scale;
    if (screenRadius > 5 && screenRadius < Math.max(canvas.width, canvas.height)) {
      const center = auToScreen(0, 0);
      ctx.beginPath();
      ctx.arc(center.sx, center.sy, screenRadius, 0, 2 * Math.PI);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.font = '10px Inter, sans-serif';
      ctx.fillText(`${r} AU`, center.sx + screenRadius * 0.707 + 5, center.sy - screenRadius * 0.707);
    }
  });
  ctx.setLineDash([]);

  // 2. Draw Sun
  const sunPosAU = { x: 0 - frameState.cx, y: 0 - frameState.cy };
  if (frameState.corotAngle !== 0.0) {
    const c = Math.cos(frameState.corotAngle), s = Math.sin(frameState.corotAngle);
    const xr = sunPosAU.x * c - sunPosAU.y * s;
    const yr = sunPosAU.x * s + sunPosAU.y * c;
    sunPosAU.x = xr; sunPosAU.y = yr;
  }
  const sunPos = auToScreen(sunPosAU.x, sunPosAU.y);
  ctx.fillStyle = 'rgba(255, 224, 102, 0.25)';
  ctx.beginPath();
  ctx.arc(sunPos.sx, sunPos.sy, 16, 0, 2 * Math.PI);
  ctx.fill();

  ctx.fillStyle = '#FFE066';
  ctx.beginPath();
  ctx.arc(sunPos.sx, sunPos.sy, 7, 0, 2 * Math.PI);
  ctx.fill();

  // 3. Draw Planet Orbit Rings
  dataset.planets.forEach(p => {
    ctx.strokeStyle = p.color;
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let step = 0; step <= 120; step++) {
      const E = (step / 120) * 2 * Math.PI;
      const xOrb = p.a * (Math.cos(E) - p.e);
      const yOrb = p.a * Math.sqrt(1 - p.e * p.e) * Math.sin(E);
      
      const Om = (p.Omega * Math.PI) / 180, om = (p.omega * Math.PI) / 180, i = (p.i * Math.PI) / 180;
      const Px = Math.cos(om)*Math.cos(Om) - Math.sin(om)*Math.sin(Om)*Math.cos(i);
      const Py = Math.cos(om)*Math.sin(Om) + Math.sin(om)*Math.cos(Om)*Math.cos(i);
      const Qx = -Math.sin(om)*Math.cos(Om) - Math.cos(om)*Math.sin(Om)*Math.cos(i);
      const Qy = -Math.sin(om)*Math.sin(Om) + Math.cos(om)*Math.cos(Om)*Math.cos(i);

      let x = xOrb * Px + yOrb * Qx;
      let y = xOrb * Py + yOrb * Qy;

      x -= frameState.cx;
      y -= frameState.cy;

      if (frameState.corotAngle !== 0.0) {
        const c = Math.cos(frameState.corotAngle), s = Math.sin(frameState.corotAngle);
        const xr = x * c - y * s, yr = x * s + y * c;
        x = xr; y = yr;
      }

      const pt = auToScreen(x, y);
      if (step === 0) ctx.moveTo(pt.sx, pt.sy);
      else ctx.lineTo(pt.sx, pt.sy);
    }
    ctx.stroke();
  });
  ctx.globalAlpha = 1.0;

  // 4. Draw Asteroid Swarms
  ctx.globalAlpha = asteroidOpacity;
  const halfSize = asteroidSize / 2;
  dataset.asteroids.forEach(ast => {
    if (!activePopulations.has(ast.pop)) return;

    const pos = computeBodyPosition(ast, currentYear, frameState);
    const scr = auToScreen(pos.x, pos.y);

    if (scr.sx >= -10 && scr.sx <= canvas.width + 10 && scr.sy >= -10 && scr.sy <= canvas.height + 10) {
      ctx.fillStyle = ast.color;
      ctx.fillRect(scr.sx - halfSize, scr.sy - halfSize, asteroidSize, asteroidSize);
    }
  });
  ctx.globalAlpha = 1.0;

  // 5. Draw Planets & Labels
  dataset.planets.forEach(p => {
    const pos = computeBodyPosition(p, currentYear, frameState);
    const scr = auToScreen(pos.x, pos.y);

    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(scr.sx, scr.sy, Math.max(3, p.size * 0.8), 0, 2 * Math.PI);
    ctx.fill();

    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.fillText(p.name, scr.sx + 8, scr.sy + 4);
  });

  // 6. Draw Named Asteroids
  if (dataset.named_asteroids) {
    dataset.named_asteroids.forEach(ast => {
      const pos = computeBodyPosition(ast, currentYear, frameState);
      const scr = auToScreen(pos.x, pos.y);

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(scr.sx, scr.sy, 2.5, 0, 2 * Math.PI);
      ctx.fill();

      ctx.fillStyle = ast.color || '#00E5FF';
      ctx.font = '10px Inter, sans-serif';
      ctx.fillText(ast.name, scr.sx + 5, scr.sy - 4);
    });
  }

  // 7. Draw Selected Body Fading Motion Ribbon Trail & Reticle
  if (selectedBody) {
    const selPos = computeBodyPosition(selectedBody, currentYear, frameState);
    const selScr = auToScreen(selPos.x, selPos.y);

    // Fading Motion Ribbon Trail
    if (trailPoints.length > 1) {
      for (let idx = 1; idx < trailPoints.length; idx++) {
        const ratio = idx / trailPoints.length; // 0.0 at tail -> 1.0 at head
        const alpha = ratio * ratio * 0.95;    // Smooth quadratic fade out at tail
        const lineWidth = 0.5 + ratio * 2.5;   // Tapering line width from tail (0.5px) to head (3px)

        const ptPrev = auToScreen(trailPoints[idx - 1].x, trailPoints[idx - 1].y);
        const ptCurr = auToScreen(trailPoints[idx].x, trailPoints[idx].y);

        ctx.strokeStyle = selectedBody.color || '#00E5FF';
        ctx.lineWidth = lineWidth;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(ptPrev.sx, ptPrev.sy);
        ctx.lineTo(ptCurr.sx, ptCurr.sy);
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;
    }

    // c. Plot Target Reticle & Label
    ctx.strokeStyle = '#00E5FF';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(selScr.sx, selScr.sy, 12, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.strokeStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(selScr.sx, selScr.sy, 18, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.fillStyle = '#00E5FF';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillText(`🎯 ${selectedBody.name || selectedBody.id}`, selScr.sx + 15, selScr.sy - 15);
  }
}

window.addEventListener('DOMContentLoaded', initApp);
