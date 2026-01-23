import * as THREE from './three.module.js';

// Configuration Constants
const GLOBE_CONFIG = {
    RADIUS: 2.8,                    // Globe radius in 3D space units
    INITIAL_ROTATION_Z: 0.41,      // Initial Z-axis rotation (radians) for visual angle
    INITIAL_POSITION_Y: -8,        // Starting Y position (off-screen)
    TARGET_POSITION_Y: 0,          // Target Y position (on-screen)
    INITIAL_CAMERA_Z: 3,           // Initial camera distance
    TARGET_CAMERA_Z: 6,            // Target camera distance (zoom out)
    GEOMETRY_SEGMENTS: 64,         // Sphere geometry detail level
    OCCLUDER_SCALE: 0.98           // Occluder sphere scale relative to globe
};

const ANIMATION_CONFIG = {
    ENTRY_DURATION: 4000,          // Globe entry animation duration (ms)
    SPAWN_INTERVAL: 400,           // Attack line spawn interval (ms)
    ROTATION_SPEED: 0.000405      // Globe rotation speed per frame
};

const RENDERER_CONFIG = {
    FOV: 75,                       // Camera field of view
    NEAR_PLANE: 0.1,               // Camera near clipping plane
    FAR_PLANE: 1000,                // Camera far clipping plane
    TONE_MAPPING: THREE.ACESFilmicToneMapping,
    TONE_EXPOSURE: 1
};

let globe;
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
    RENDERER_CONFIG.FOV,
    window.innerWidth / window.innerHeight,
    RENDERER_CONFIG.NEAR_PLANE,
    RENDERER_CONFIG.FAR_PLANE
);
const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance"
});
renderer.toneMapping = RENDERER_CONFIG.TONE_MAPPING;
renderer.toneMappingExposure = RENDERER_CONFIG.TONE_EXPOSURE;

// Animation Control
let entryStartTime = null;
let isEntryActive = false;
let assetsReady = false;

window.animateGlobeIn = () => {
    isEntryActive = true;
};

function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
}

if (container) {
    // Lite Mode: Disable 3D globe entirely on mobile
    if (window.innerWidth < 768) {
        // Mobile detected: Lite Mode active (Globe disabled)
    } else {
        init();
    }
}

async function init() {
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Mobile Optimization
    const isMobile = window.innerWidth < 768;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
    container.appendChild(renderer.domElement);

    const geometry = new THREE.SphereGeometry(
        GLOBE_CONFIG.RADIUS,
        GLOBE_CONFIG.GEOMETRY_SEGMENTS,
        GLOBE_CONFIG.GEOMETRY_SEGMENTS
    );
    const material = new THREE.MeshStandardMaterial({
        transparent: true,
        opacity: 0,
        roughness: 0.7,
        metalness: 0.2
    });

    globe = new THREE.Mesh(geometry, material);
    globe.rotation.z = GLOBE_CONFIG.INITIAL_ROTATION_Z;
    globe.position.set(0, GLOBE_CONFIG.INITIAL_POSITION_Y, 0);
    globe.visible = false;
    globe.renderOrder = 2;
    scene.add(globe);

    // Occluder
    const occluderGeometry = new THREE.SphereGeometry(
        GLOBE_CONFIG.RADIUS * GLOBE_CONFIG.OCCLUDER_SCALE,
        GLOBE_CONFIG.GEOMETRY_SEGMENTS,
        GLOBE_CONFIG.GEOMETRY_SEGMENTS
    );
    const occluderMaterial = new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: true,
        transparent: false
    });
    const occluder = new THREE.Mesh(occluderGeometry, occluderMaterial);
    occluder.renderOrder = 1;
    globe.add(occluder);

    // Setup Loading Manager
    const loadingManager = new THREE.LoadingManager();
    loadingManager.onLoad = () => {
        assetsReady = true;
    };

    // Load Texture
    const textureLoader = new THREE.TextureLoader(loadingManager);
    textureLoader.load('globe-map.jpg', (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        material.map = texture;
        material.needsUpdate = true;
    });

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
    sunLight.position.set(5, 3, 5);
    scene.add(sunLight);
    const fillLight = new THREE.PointLight(0x7c9ee2, 2, 50);
    fillLight.position.set(-5, -3, 2);
    scene.add(fillLight);

    camera.position.z = 3;

    function handleResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    let resizeTimeout;
    const debouncedResize = () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(handleResize, 150);
    };
    window.addEventListener('resize', debouncedResize);

    let lastSpawnTime = 0;
    const spawnInterval = 400;
    const attackLines = [];
    const countryCentroids = [];

    async function initBorders() {
        const borderMaterial = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.12,
            blending: THREE.AdditiveBlending
        });

        try {
            const response = await fetch('country.json');
            const data = await response.json();

            const allPoints = [];
            data.features.forEach(feature => {
                const geometry = feature.geometry;
                if (!geometry) return;

                if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
                    const coords = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0];
                    let latSum = 0, lonSum = 0, count = 0;
                    coords.forEach(c => {
                        lonSum += c[0]; latSum += c[1]; count++;
                    });
                    if (count > 0) countryCentroids.push([lonSum / count, latSum / count]);
                }

                const processRing = (ring) => {
                    for (let i = 0; i < ring.length - 1; i++) {
                        allPoints.push(lonLatToVector3(ring[i][0], ring[i][1], GLOBE_CONFIG.RADIUS + 0.01));
                        allPoints.push(lonLatToVector3(ring[i + 1][0], ring[i + 1][1], GLOBE_CONFIG.RADIUS + 0.01));
                    }
                };

                if (geometry.type === 'Polygon') {
                    geometry.coordinates.forEach(processRing);
                } else if (geometry.type === 'MultiPolygon') {
                    geometry.coordinates.forEach(poly => poly.forEach(processRing));
                }
            });

            const borderGeometry = new THREE.BufferGeometry().setFromPoints(allPoints);
            const segments = new THREE.LineSegments(borderGeometry, borderMaterial);
            segments.renderOrder = 3;
            globe.add(segments);
        } catch (err) {
            // Non-critical error - borders are visual enhancement, site still functional
            console.warn("[Globe Borders] Failed to load:", err);
            // Optionally, we could set a flag to remind the user about the missing asset
            const container = document.getElementById('canvas-container');
            if (container) {
                const note = document.createElement('div');
                note.className = 'globe-fallback-note';
                note.style.cssText = 'position:absolute;bottom:10px;left:10px;font-size:10px;color:rgba(255,255,255,0.2);pointer-events:none;';
                note.textContent = 'Visualization reduced mode';
                container.appendChild(note);
            }
        }
    }

    await initBorders();

    // Pause animation when page is hidden (performance optimization)
    let isPageVisible = true;
    let animationId = null;
    let isAnimating = false;

    document.addEventListener('visibilitychange', () => {
        isPageVisible = !document.hidden;
        if (isPageVisible) {
            if (!isAnimating && globe.visible) {
                animate(performance.now());
            }
        } else {
            if (animationId) {
                cancelAnimationFrame(animationId);
                animationId = null;
                isAnimating = false;
            }
        }
    });

    function animate(time) {
        if (!isAnimating) {
            isAnimating = true;
        }

        animationId = requestAnimationFrame(animate);

        // Skip rendering when page is hidden
        if (!isPageVisible) return;

        // Only animate if globe should be visible (after entry animation or if already visible)
        if (!globe.visible && !isEntryActive) return;

        if (isEntryActive && assetsReady) {
            if (!entryStartTime) entryStartTime = time;
            const elapsed = time - entryStartTime;
            const progress = Math.min(elapsed / ANIMATION_CONFIG.ENTRY_DURATION, 1);
            const easedProgress = easeOutQuart(progress);

            globe.visible = true;
            globe.position.y = GLOBE_CONFIG.INITIAL_POSITION_Y +
                (GLOBE_CONFIG.TARGET_POSITION_Y - GLOBE_CONFIG.INITIAL_POSITION_Y) * easedProgress;
            camera.position.z = GLOBE_CONFIG.INITIAL_CAMERA_Z +
                (GLOBE_CONFIG.TARGET_CAMERA_Z - GLOBE_CONFIG.INITIAL_CAMERA_Z) * easedProgress;

            globe.traverse((obj) => {
                if (obj.material) {
                    obj.material.transparent = true;
                    if (obj.userData.targetOpacity === undefined) {
                        obj.userData.targetOpacity = obj.material.opacity || 0;
                        if (obj === globe) obj.userData.targetOpacity = 1;
                    }
                    obj.material.opacity = obj.userData.targetOpacity * easedProgress;
                }
            });

            if (progress === 1) isEntryActive = false;
        }

        globe.rotation.y -= ANIMATION_CONFIG.ROTATION_SPEED;

        if (globe.visible) {
            if (time - lastSpawnTime > ANIMATION_CONFIG.SPAWN_INTERVAL) {
                createAttack(time, countryCentroids, globe, attackLines, GLOBE_CONFIG.RADIUS);
                lastSpawnTime = time;
            }

            for (let i = attackLines.length - 1; i >= 0; i--) {
                if (!attackLines[i].update(time)) {
                    const line = attackLines[i].mesh;
                    line.geometry.dispose();
                    line.material.dispose();
                    globe.remove(line);
                    attackLines.splice(i, 1);
                }
            }
        }

        renderer.render(scene, camera);
    }
    window.destroyGlobe = () => {
        window.removeEventListener('resize', debouncedResize);
        if (animationId) cancelAnimationFrame(animationId);
        if (renderer && renderer.domElement && renderer.domElement.parentNode) {
            renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
        renderer.dispose();
    };

    animate(0);
}

function lonLatToVector3(lon, lat, radius) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    return new THREE.Vector3(
        -radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta)
    );
}

function createAttack(time, countryCentroids, globe, attackLines, radius) {
    if (countryCentroids.length < 2) return;

    const startIdx = Math.floor(Math.random() * countryCentroids.length);
    let endIdx = Math.floor(Math.random() * countryCentroids.length);
    while (startIdx === endIdx) endIdx = Math.floor(Math.random() * countryCentroids.length);

    const start = lonLatToVector3(countryCentroids[startIdx][0], countryCentroids[startIdx][1], radius);
    const end = lonLatToVector3(countryCentroids[endIdx][0], countryCentroids[endIdx][1], radius);

    const mid = start.clone().lerp(end, 0.5);
    const dist = start.distanceTo(end);
    mid.normalize().multiplyScalar(radius + dist * 0.5);

    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const totalPoints = 100;
    const points = curve.getPoints(totalPoints);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    const material = new THREE.LineBasicMaterial({
        color: 0x39ff14,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending
    });

    const line = new THREE.Line(geometry, material);
    line.renderOrder = 4;
    globe.add(line);

    const duration = 2500 + Math.random() * 2000;
    const pauseTime = 150;
    let startAnimate = null;

    attackLines.push({
        mesh: line,
        update: (time) => {
            if (!startAnimate) startAnimate = time;
            const elapsed = time - startAnimate;
            const growDuration = duration * 0.45;
            const wipeDuration = duration * 0.45;

            if (elapsed < growDuration) {
                const progress = elapsed / growDuration;
                line.geometry.setDrawRange(0, Math.floor(progress * totalPoints));
                material.opacity = progress * 0.9;
            } else if (elapsed < growDuration + pauseTime) {
                line.geometry.setDrawRange(0, totalPoints);
                material.opacity = 0.9;
            } else if (elapsed < growDuration + pauseTime + wipeDuration) {
                const progress = (elapsed - (growDuration + pauseTime)) / wipeDuration;
                const startIdx = Math.floor(progress * totalPoints);
                line.geometry.setDrawRange(startIdx, totalPoints - startIdx);
                material.opacity = (1 - progress) * 0.9;
            } else {
                return false;
            }
            return true;
        }
    });
}
