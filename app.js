import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js';

const scenes = [...document.querySelectorAll('.scene')];
const videos = [...document.querySelectorAll('.cinematic-video')];
const progressBar = document.querySelector('#progressBar');
const modeStatus = document.querySelector('#modeStatus');
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const smoothstep = (start, end, value) => {
  const x = clamp((value - start) / (end - start));
  return x * x * (3 - 2 * x);
};

let targetProgress = 0;
let smoothProgress = 0;
let ceremonyActive = false;
let experienceSoundEnabled = false;
let audioContext, ambienceGain, ambienceOscillator;
let pointerX = 0, pointerY = 0;
const lastVideoTimes = new WeakMap();

function scrollProgress() {
  const max = document.documentElement.scrollHeight - innerHeight;
  return max > 0 ? clamp(scrollY / max) : 0;
}

function setTimeline(progress, { syncScroll = true } = {}) {
  ceremonyActive = false;
  targetProgress = clamp(progress);
  videos.forEach((video, index) => scrubVideo(video, sceneLocalProgress(targetProgress, index)));
  if (!syncScroll) return;
  const max = document.documentElement.scrollHeight - innerHeight;
  scrollTo({ top: targetProgress * max, behavior: 'smooth' });
}

function goToRelative(direction) {
  setTimeline(targetProgress + direction * .2);
}

addEventListener('scroll', () => {
  if (!ceremonyActive) targetProgress = scrollProgress();
}, { passive: true });
addEventListener('pointermove', event => {
  pointerX = event.clientX / innerWidth - .5;
  pointerY = event.clientY / innerHeight - .5;
}, { passive: true });
addEventListener('wheel', enableExperienceSound, { passive: true, once: true });

function sceneWeights(progress) {
  return [
    smoothstep(.12, .2, progress) * (1 - smoothstep(.37, .45, progress)),
    smoothstep(.34, .45, progress) * (1 - smoothstep(.6, .69, progress)),
    smoothstep(.58, .69, progress) * (1 - smoothstep(.82, .9, progress)),
  ];
}

function sceneLocalProgress(progress, index) {
  const ranges = [[.12, .45], [.34, .69], [.58, .9]];
  const [start, end] = ranges[index];
  return clamp((progress - start) / (end - start));
}

function scrubVideo(video, progress) {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;
  const nextTime = clamp(progress) * Math.max(0, video.duration - .08);
  const previousTime = lastVideoTimes.get(video) ?? -1;
  if (Math.abs(nextTime - previousTime) < .035) return;
  try {
    video.currentTime = nextTime;
    lastVideoTimes.set(video, nextTime);
  } catch { /* Metadata may still be loading. */ }
}

function updateVideos(progress) {
  const weights = sceneWeights(progress);
  videos.forEach((video, index) => {
    const weight = weights[index];
    const local = sceneLocalProgress(progress, index);
    const scale = index === 0 ? 1.2 + local * .08 : 1.04 + local * .08;
    video.style.opacity = weight.toFixed(3);
    video.style.transform = `scale(${scale}) translate3d(${pointerX * (index + 1) * 1.4}%, ${pointerY * (index + 1)}%, 0)`;
    // Keep each layer alive as a real video; only timeline jumps need a seek.
    video.play().catch(() => {});
  });
}

function updateCopy(progress) {
  scenes.forEach((scene, index) => {
    const sceneProgress = index === 0 ? smoothstep(0, .16, progress)
      : index === 4 ? smoothstep(.82, .96, progress)
        : sceneWeights(progress)[index - 1];
    scene.classList.toggle('active', sceneProgress > .35);
    const reveal = scene.querySelectorAll('.reveal');
    reveal.forEach((element, revealIndex) => {
      const opacity = clamp(sceneProgress * 1.8 - revealIndex * .08);
      element.style.opacity = opacity;
      element.style.transform = `translate3d(0, ${(1 - opacity) * 26}px, 0)`;
    });
  });
}

function updateAmbience(progress) {
  if (!ambienceOscillator || !audioContext) return;
  const notes = [42, 48, 58, 68];
  const index = progress < .2 ? 0 : progress < .45 ? 1 : progress < .69 ? 2 : 3;
  ambienceOscillator.frequency.exponentialRampToValueAtTime(notes[index], audioContext.currentTime + .12);
}

function renderTimeline(progress) {
  progressBar.style.width = `${progress * 100}%`;
  document.documentElement.style.setProperty('--scroll-progress', progress);
  updateVideos(progress);
  updateCopy(progress);
  updateAmbience(progress);
}

function enableExperienceSound() {
  experienceSoundEnabled = true;
  const activeIndex = sceneWeights(smoothProgress).indexOf(Math.max(...sceneWeights(smoothProgress)));
  videos.forEach((video, index) => { video.muted = index !== activeIndex; });
  videos[activeIndex]?.play().catch(() => {});
  if (audioContext) {
    audioContext.resume();
    return;
  }
  audioContext = new AudioContext();
  ambienceGain = audioContext.createGain();
  ambienceGain.gain.value = .018;
  const filter = audioContext.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 140;
  ambienceOscillator = audioContext.createOscillator();
  ambienceOscillator.type = 'sine';
  ambienceOscillator.frequency.value = 48;
  ambienceOscillator.connect(filter).connect(ambienceGain).connect(audioContext.destination);
  ambienceOscillator.start();
}

function startCeremony() {
  ceremonyActive = true;
  targetProgress = 0;
  modeStatus.textContent = 'CEREMONY LIVE';
}

document.querySelector('#ceremonyTrigger').addEventListener('click', () => {
  enableExperienceSound();
  startCeremony();
});
addEventListener('nexora:ceremony-start', () => {
  enableExperienceSound();
  startCeremony();
});

let touchStartX = 0;
addEventListener('touchstart', event => { touchStartX = event.changedTouches[0].clientX; }, { passive: true });
addEventListener('touchend', event => {
  const delta = event.changedTouches[0].clientX - touchStartX;
  if (Math.abs(delta) < 72) return;
  enableExperienceSound();
  goToRelative(delta < 0 ? 1 : -1);
}, { passive: true });

const stage = document.querySelector('#threeStage');
const renderer = new THREE.WebGLRenderer({ canvas: stage, alpha: true, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 700 ? 1.2 : 1.5));
const threeScene = new THREE.Scene();
const threeCamera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, .1, 100);
threeCamera.position.z = 7;
const particleCount = innerWidth < 700 ? 300 : 900;
const positions = new Float32Array(particleCount * 3);
const basePositions = new Float32Array(particleCount * 3);
for (let i = 0; i < particleCount; i++) {
  const angle = Math.random() * Math.PI * 2;
  const radius = 1.1 + Math.random() * 6;
  basePositions[i * 3] = Math.cos(angle) * radius;
  basePositions[i * 3 + 1] = Math.sin(angle) * radius;
  basePositions[i * 3 + 2] = (Math.random() - .5) * 6;
}
positions.set(basePositions);
const particlesGeometry = new THREE.BufferGeometry();
particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const particlesMaterial = new THREE.PointsMaterial({ color: 0xd9ff3f, size: .026, transparent: true, opacity: .85, depthWrite: false });
const particles = new THREE.Points(particlesGeometry, particlesMaterial);
threeScene.add(particles);

function resizeThree() {
  renderer.setSize(innerWidth, innerHeight, false);
  threeCamera.aspect = innerWidth / innerHeight;
  threeCamera.updateProjectionMatrix();
}
addEventListener('resize', resizeThree);
resizeThree();

function animate(time) {
  if (ceremonyActive) {
    targetProgress = Math.min(1, targetProgress + .00008);
    const max = document.documentElement.scrollHeight - innerHeight;
    scrollTo({ top: targetProgress * max, behavior: 'auto' });
    if (targetProgress >= 1) {
      ceremonyActive = false;
      modeStatus.textContent = 'THE CLUB / 2026';
    }
  }
  smoothProgress += (targetProgress - smoothProgress) * .075;
  renderTimeline(smoothProgress);

  const ignition = smoothstep(.34, .69, smoothProgress);
  const moment = smoothstep(.58, .9, smoothProgress);
  const attribute = particlesGeometry.attributes.position;
  for (let i = 0; i < particleCount; i++) {
    const x = basePositions[i * 3], y = basePositions[i * 3 + 1], z = basePositions[i * 3 + 2];
    const wave = Math.sin(time * .0015 + i * .19) * ignition * .8;
    attribute.array[i * 3] = x * (1 + ignition * .7 - moment * .25) + Math.sin(i * 1.7) * moment * .8;
    attribute.array[i * 3 + 1] = y * (1 + moment * .4) + wave;
    attribute.array[i * 3 + 2] = z + ignition * Math.sin(i * .63) * 2 - moment * 1.5;
  }
  attribute.needsUpdate = true;
  particles.rotation.y = time * .00007 + smoothProgress * Math.PI * 7;
  particles.rotation.x = Math.sin(time * .00015) * .15 + smoothProgress * 1.2;
  particlesMaterial.size = .022 + ignition * .012 + moment * .006;
  particlesMaterial.opacity = .68 + ignition * .2;
  threeCamera.position.x += (pointerX * .45 - threeCamera.position.x) * .04;
  threeCamera.position.y += (-pointerY * .28 - threeCamera.position.y) * .04;
  threeCamera.position.z = 7 - ignition * .7 - moment * .4;
  renderer.render(threeScene, threeCamera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

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
  voiceState.textContent = 'LISTENING';
  voiceText.textContent = 'Say next, back, start, ceremony, or invitation.';
  recognition.start();
  recognition.onresult = event => {
    const memo = event.results[0][0].transcript.trim();
    const command = memo.toLowerCase();
    voiceState.textContent = 'VOICE MEMO CAPTURED';
    voiceText.textContent = memo;
    if (/ceremony|inauguration|auto/.test(command)) startCeremony();
    else if (/next|forward|continue|enter/.test(command)) goToRelative(1);
    else if (/back|previous|return/.test(command)) goToRelative(-1);
    else if (/start|begin|home|reset/.test(command)) setTimeline(0);
    else if (/invitation|rsvp|inside|contact/.test(command)) setTimeline(.9);
  };
  recognition.onerror = () => { voiceState.textContent = 'VOICE MEMO NOT CAPTURED'; voiceText.textContent = 'Please allow microphone access and try once more.'; };
  recognition.onend = () => voiceTrigger.classList.remove('listening');
});

const gestureTrigger = document.querySelector('#gestureTrigger');
const gesturePanel = document.querySelector('#gesturePanel');
const camera = document.querySelector('#gestureVideo');
const canvas = document.querySelector('#gestureCanvas');
const context = canvas.getContext('2d');
const gestureState = document.querySelector('#gestureState');
const gestureText = document.querySelector('#gestureText');
let stream, handLandmarker, lastX, lastGestureAt = 0, detecting = false;
document.querySelector('#gestureClose').addEventListener('click', stopGestures);
gestureTrigger.addEventListener('click', startGestures);

async function startGestures() {
  if (!navigator.mediaDevices?.getUserMedia) return alert('Camera gestures are not supported in this browser.');
  gestureTrigger.textContent = 'CONNECTING CAMERA';
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 360 } }, audio: false });
    camera.srcObject = stream;
    await camera.play();
    const version = '0.10.14';
    const { FilesetResolver, HandLandmarker } = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/vision_bundle.mjs`);
    const vision = await FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/wasm`);
    handLandmarker = await HandLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task' }, runningMode: 'VIDEO', numHands: 1 });
    gesturePanel.classList.add('show');
    gesturePanel.setAttribute('aria-hidden', 'false');
    gestureTrigger.textContent = 'GESTURES ACTIVE';
    gestureState.textContent = 'GESTURE CONTROL ACTIVE';
    gestureText.textContent = 'Swipe an open hand left or right to move the film timeline.';
    detecting = true;
    detectHand();
  } catch (error) {
    console.warn('Gesture controls unavailable:', error);
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
    gesturePanel.classList.add('show');
    gestureState.textContent = 'GESTURES NEED ATTENTION';
    gestureText.textContent = 'Allow camera access, then retry.';
    gestureTrigger.textContent = 'RETRY GESTURES';
  }
}

function stopGestures() {
  detecting = false;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  lastX = undefined;
  gesturePanel.classList.remove('show');
  gesturePanel.setAttribute('aria-hidden', 'true');
  gestureTrigger.textContent = 'ENABLE GESTURES';
}

function detectHand() {
  if (!detecting || !handLandmarker) return;
  const result = handLandmarker.detectForVideo(camera, performance.now());
  canvas.width = camera.videoWidth;
  canvas.height = camera.videoHeight;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const hand = result.landmarks?.[0];
  if (hand) {
    gestureState.textContent = 'HAND DETECTED';
    context.fillStyle = '#d9ff3f';
    hand.forEach(point => { context.beginPath(); context.arc(point.x * canvas.width, point.y * canvas.height, 3, 0, Math.PI * 2); context.fill(); });
    const x = hand[9].x;
    const now = performance.now();
    if (lastX !== undefined && now - lastGestureAt > 800 && Math.abs(x - lastX) > .15) {
      goToRelative(x > lastX ? -1 : 1);
      lastGestureAt = now;
    }
    lastX = x;
  }
  requestAnimationFrame(detectHand);
}
