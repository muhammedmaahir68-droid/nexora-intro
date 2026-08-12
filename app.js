const scenes = [...document.querySelectorAll('.scene')];
const navButtons = [...document.querySelectorAll('.scene-nav button')];
const progress = document.querySelector('#progressBar');
const videos = [...document.querySelectorAll('.chapter-video')];

function setActive(index) {
  scenes.forEach((scene, i) => scene.classList.toggle('active', i === index));
  navButtons.forEach((button, i) => button.classList.toggle('is-current', i === index));
}

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const index = Number(entry.target.dataset.scene);
    setActive(index);
    const video = entry.target.querySelector('.chapter-video');
    if (video) video.play().catch(() => {});
  });
}, { threshold: .58 });
scenes.forEach(scene => observer.observe(scene));

addEventListener('scroll', () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  progress.style.width = `${max ? (scrollY / max) * 100 : 0}%`;
}, { passive: true });

navButtons.forEach((button, index) => button.addEventListener('click', () => {
  scenes[index].scrollIntoView({ behavior: 'smooth', block: 'start' });
}));

document.querySelectorAll('.sound-toggle').forEach((button) => button.addEventListener('click', () => {
  const video = button.closest('.chapter-video-wrap').querySelector('video');
  video.muted = !video.muted;
  button.querySelector('span').textContent = video.muted ? 'OFF' : 'ON';
  if (!video.paused) video.play();
}));

let touchStartX = 0;
addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].clientX; }, { passive: true });
addEventListener('touchend', e => {
  const delta = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(delta) < 95) return;
  goToRelative(delta < 0 ? 1 : -1);
}, { passive: true });

function currentScene() { return scenes.findIndex(scene => scene.classList.contains('active')); }
function goToRelative(direction) {
  const target = Math.max(0, Math.min(scenes.length - 1, currentScene() + direction));
  scenes[target].scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const voiceTrigger = document.querySelector('#voiceTrigger');
const voicePanel = document.querySelector('#voicePanel');
const voiceState = document.querySelector('#voiceState');
const voiceText = document.querySelector('#voiceText');
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
voiceTrigger.addEventListener('click', () => {
  voicePanel.classList.add('show');
  if (!SpeechRecognition) {
    voiceState.textContent = 'VOICE COMMAND UNAVAILABLE';
    voiceText.textContent = 'Use Chrome or Edge to enable browser voice commands.';
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = navigator.language || 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  voiceTrigger.classList.add('listening');
  voiceState.textContent = 'LISTENING…';
  voiceText.textContent = 'Say “next”, “back”, “start”, or “invitation”.';
  recognition.start();
  recognition.onresult = event => {
    const memo = event.results[0][0].transcript.trim();
    const command = memo.toLowerCase();
    voiceState.textContent = 'VOICE MEMO CAPTURED';
    voiceText.textContent = `“${memo}”`;
    if (/next|forward|continue/.test(command)) goToRelative(1);
    else if (/back|previous|return/.test(command)) goToRelative(-1);
    else if (/start|begin|home/.test(command)) scenes[0].scrollIntoView({ behavior: 'smooth' });
    else if (/invitation|rsvp|inside|contact/.test(command)) scenes.at(-1).scrollIntoView({ behavior: 'smooth' });
  };
  recognition.onerror = () => { voiceState.textContent = 'VOICE MEMO NOT CAPTURED'; voiceText.textContent = 'Please allow microphone access and try once more.'; };
  recognition.onend = () => voiceTrigger.classList.remove('listening');
});

const gestureTrigger = document.querySelector('#gestureTrigger');
const gesturePanel = document.querySelector('#gesturePanel');
const camera = document.querySelector('#gestureVideo');
const canvas = document.querySelector('#gestureCanvas');
const context = canvas.getContext('2d');
let stream, handLandmarker, lastX, lastGestureAt = 0, detecting = false;

document.querySelector('#gestureClose').addEventListener('click', stopGestures);
gestureTrigger.addEventListener('click', startGestures);

async function startGestures() {
  if (!navigator.mediaDevices?.getUserMedia) return alert('Camera gestures are not supported in this browser.');
  gestureTrigger.textContent = 'CONNECTING CAMERA…';
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 480, height: 360 }, audio: false });
    camera.srcObject = stream;
    await camera.play();
    const { FilesetResolver, HandLandmarker } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22');
    const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm');
    handLandmarker = await HandLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task' }, runningMode: 'VIDEO', numHands: 1 });
    gesturePanel.classList.add('show');
    gesturePanel.setAttribute('aria-hidden', 'false');
    gestureTrigger.textContent = 'GESTURES ACTIVE';
    detecting = true;
    detectHand();
  } catch (error) {
    console.warn('Gesture controls unavailable:', error);
    gestureTrigger.textContent = 'GESTURES UNAVAILABLE';
    if (stream) stream.getTracks().forEach(track => track.stop());
  }
}

function stopGestures() {
  detecting = false;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null; lastX = undefined;
  gesturePanel.classList.remove('show');
  gesturePanel.setAttribute('aria-hidden', 'true');
  gestureTrigger.innerHTML = '<span class="hand-mark">✦</span> ENABLE GESTURES';
}

function detectHand() {
  if (!detecting || !handLandmarker) return;
  const result = handLandmarker.detectForVideo(camera, performance.now());
  canvas.width = camera.videoWidth; canvas.height = camera.videoHeight;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const hand = result.landmarks?.[0];
  if (hand) {
    context.fillStyle = '#d9ff3f';
    hand.forEach(point => { context.beginPath(); context.arc(point.x * canvas.width, point.y * canvas.height, 3, 0, Math.PI * 2); context.fill(); });
    const x = hand[9].x;
    const now = performance.now();
    if (lastX !== undefined && now - lastGestureAt > 900) {
      const shift = x - lastX;
      if (Math.abs(shift) > .15) { goToRelative(shift > 0 ? -1 : 1); lastGestureAt = now; }
    }
    lastX = x;
  }
  requestAnimationFrame(detectHand);
}
