let wasmModule = null;
let cb = null;
let provider = null;
let currentSeed = null;
let seedList = [];
let isRunning = false;
let seedResults = new Map();

document.addEventListener('DOMContentLoaded', () => {
    const wasmFile = document.getElementById('wasmFile');
    const dropZone = document.getElementById('wasmDropZone');

    wasmFile.addEventListener('change', handleWasmFile);
    document.getElementById('mode').addEventListener('change', updateInputs);
    document.getElementById('coordMode').addEventListener('change', updateCoordInputs);
    document.getElementById('seedListFile').addEventListener('change', handleSeedListFile);
    document.getElementById('calculateBtn').addEventListener('click', calculate);
    document.getElementById('stopBtn').addEventListener('click', stopCalc);
    document.querySelector('.info-btn').addEventListener('click', toggleInfo);

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].name.endsWith('.wasm')) {
            wasmFile.files = files;
            handleWasmFile({ target: { files } });
        }
    });

    document.addEventListener('click', (event) => {
        const infoContent = document.getElementById('infoContent');
        const infoBtn = document.querySelector('.info-btn');
        if (!infoBtn.contains(event.target) && !infoContent.contains(event.target)) {
            infoContent.classList.remove('active');
        }
    });
});

async function handleWasmFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.wasm')) {
        showError('WASM FILE ONLY');
        return;
    }

    const status = document.getElementById('wasmStatus');
    const dropText = document.getElementById('dropText');
    status.textContent = 'LOADING...';

    try {
        const buffer = await file.arrayBuffer();
        wasmModule = await WebAssembly.compile(buffer);
        cb = createCb(wasmModule);
        status.textContent = 'READY';
        dropText.textContent = file.name;
        document.getElementById('wasmDropZone').classList.add('loaded');
        document.getElementById('mainInputs').classList.remove('hidden');
        updateInputs();
    } catch (error) {
        status.textContent = 'ERROR: ' + error.message;
        console.error(error);
    }
}

async function handleSeedListFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.txt') && !file.name.endsWith('.csv')) {
        showError('TXT OR CSV FILE ONLY');
        return;
    }

    const status = document.getElementById('seedListStatus');
    status.textContent = 'LOADING...';

    try {
        const text = await file.text();
        seedList = text.split('\n')
            .map(line => line.trim())
            .filter(line => line);
        status.textContent = 'LOADED ' + seedList.length + ' SEEDS';
        updateInputs();
    } catch (error) {
        status.textContent = 'ERROR: ' + error.message;
        console.error(error);
    }
}

function updateInputs() {
    const mode = document.getElementById('mode').value;

    document.getElementById('seedListInputs').classList.toggle('hidden', mode !== 'list');
    document.getElementById('bruteForceInputs').classList.toggle('hidden', mode !== 'bruteforce');
    document.getElementById('commonInputs').classList.toggle('hidden', mode !== 'single');
    document.getElementById('coordinateInputs').classList.remove('hidden');
    document.getElementById('thresholdInputs').classList.toggle('hidden', mode === 'single');

    updateCoordInputs();
}

function updateCoordInputs() {
    const mode = document.getElementById('mode').value;
    const coordMode = document.getElementById('coordMode').value;

    if (mode === 'single') {
        document.getElementById('coordMode').value = 'single';
        document.getElementById('coordMode').disabled = true;
        document.getElementById('singleCoordInputs').classList.remove('hidden');
        document.getElementById('rangeCoordInputs').classList.add('hidden');
        document.getElementById('centerCoordInputs').classList.add('hidden');
    } else {
        document.getElementById('coordMode').disabled = false;
        document.getElementById('singleCoordInputs').classList.toggle('hidden', coordMode !== 'single');
        document.getElementById('rangeCoordInputs').classList.toggle('hidden', coordMode !== 'range');
        document.getElementById('centerCoordInputs').classList.toggle('hidden', coordMode !== 'center');
    }
}

function createCb(wasmModule) {
    class Long {
        constructor(low, high, unsigned = false) {
            this.low = low | 0;
            this.high = high | 0;
            this.unsigned = !!unsigned;
        }

        static fromString = (str) => {
            const bigInt = BigInt(str);
            return new Long(
                Number(bigInt & 0xffffffffn),
                Number(bigInt >> 0x20n)
            );
        };
    }

    const imports = {
        __wbindgen_placeholder__: {
            __wbindgen_json_parse: () => 0,
            __wbindgen_object_drop_ref: () => { },
            __wbindgen_json_serialize: () => { },
            __wbindgen_throw: () => { }
        }
    };

    const instance = new WebAssembly.Instance(wasmModule, imports).exports;
    const getMemory = () => new Int32Array(instance.memory.buffer);

    class World {
        constructor(seedLow, seedHigh, dimension, version, largeBiomes, biomeSize) {
            this.ptr = instance.world_new(
                seedLow, seedHigh, dimension, version,
                largeBiomes != null, largeBiomes || 0, biomeSize
            );
        }

        free = () => {
            if (this.ptr) {
                instance.__wbg_world_free(this.ptr);
                this.ptr = 0;
            }
        };
    }

    class BiomeProvider {
        constructor(world) {
            this.ptr = instance.multinoisebiomesource_new(world.ptr);
        }

        getSurfaceArea(x, z, width, height, blockSize, heightType, method) {
            const stackPtr = instance.__wbindgen_add_to_stack_pointer(-16);

            const heightTypes = {
                oceanFloor: 2,
                worldSurface: 1,
                caveDepth: 3,
                bottom: 4,
                depth0: 5
            };

            const methods = {
                fastApproximate: 1,
                enhancedNoCaves: 2,
                enhanced: 3,
                topmostAccurate: 4
            };

            instance.multinoisebiomesource_get_surface_area(
                stackPtr, this.ptr, x, z, width, height, blockSize,
                heightTypes[heightType] || 2,
                methods[method] || 2
            );

            const memory = getMemory();
            const ptr = memory[stackPtr / 4];
            const len = memory[stackPtr / 4 + 1];
            const result = new Int32Array(instance.memory.buffer, ptr, len).slice();

            instance.__wbindgen_free(ptr, len * 4, 4);
            instance.__wbindgen_add_to_stack_pointer(16);

            return result;
        }

        free = () => {
            if (this.ptr) {
                instance.__wbg_multinoisebiomesource_free(this.ptr);
                this.ptr = 0;
            }
        };
    }

    return {
        Long: Long,
        createBiomeProvider: ({ seed, version, config }) => {
            const world = new World(
                seed.low, seed.high, 2, version,
                config.largeBiomes, config.biomeSize
            );
            const provider = new BiomeProvider(world);

            return {
                getSurfaceArea: (...args) => provider.getSurfaceArea(...args),
                free: () => provider.free()
            };
        }
    };
}

async function getHeight(seed, x, z) {
    if (currentSeed !== seed) {
        provider?.free();
        provider = cb.createBiomeProvider({
            version: 0x27e2,
            config: {},
            seed: cb.Long.fromString(seed)
        });
        currentSeed = seed;
    }

    const chunkX = x >> 2;
    const chunkZ = z >> 2;
    const heights = new Int32Array(
        provider.getSurfaceArea(
            chunkX, chunkZ, 1, 1, 1, 'oceanFloor', 'enhancedNoCaves'
        ).buffer
    );

    return heights[0];
}

function checkThreshold(value, operator, threshold) {
    switch (operator) {
        case '>': return value > threshold;
        case '<': return value < threshold;
        case '=': return value === threshold;
        default: return false;
    }
}

function clearErrors() {
    document.querySelectorAll('input.error, select.error').forEach(el => {
        el.classList.remove('error');
    });
}

function markError(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.classList.add('error');
    }
}

function getCoordinates() {
    clearErrors();
    const coordMode = document.getElementById('coordMode').value;

    if (coordMode === 'single') {
        const x = parseInt(document.getElementById('x').value);
        const z = parseInt(document.getElementById('z').value);
        
        if (isNaN(x)) {
            markError('x');
            return null;
        }
        if (isNaN(z)) {
            markError('z');
            return null;
        }
        
        return [{ x, z }];
    } else if (coordMode === 'range') {
        const xMin = parseInt(document.getElementById('xMin').value);
        const xMax = parseInt(document.getElementById('xMax').value);
        const zMin = parseInt(document.getElementById('zMin').value);
        const zMax = parseInt(document.getElementById('zMax').value);
        const stepSize = parseInt(document.getElementById('stepSize').value) || 16;

        let hasError = false;
        if (isNaN(xMin)) { markError('xMin'); hasError = true; }
        if (isNaN(xMax)) { markError('xMax'); hasError = true; }
        if (isNaN(zMin)) { markError('zMin'); hasError = true; }
        if (isNaN(zMax)) { markError('zMax'); hasError = true; }
        
        if (hasError) return null;

        const coords = [];
        for (let x = xMin; x <= xMax; x += stepSize) {
            for (let z = zMin; z <= zMax; z += stepSize) {
                coords.push({ x, z });
            }
        }
        return coords;
    } else if (coordMode === 'center') {
        const centerX = parseInt(document.getElementById('centerX').value);
        const centerZ = parseInt(document.getElementById('centerZ').value);
        const radius = parseInt(document.getElementById('radius').value) || 100;
        const stepSize = parseInt(document.getElementById('centerStepSize').value) || 16;

        let hasError = false;
        if (isNaN(centerX)) { markError('centerX'); hasError = true; }
        if (isNaN(centerZ)) { markError('centerZ'); hasError = true; }
        
        if (hasError) return null;

        const coords = [];
        for (let x = centerX - radius; x <= centerX + radius; x += stepSize) {
            for (let z = centerZ - radius; z <= centerZ + radius; z += stepSize) {
                const distance = Math.sqrt((x - centerX) ** 2 + (z - centerZ) ** 2);
                if (distance <= radius) {
                    coords.push({ x, z });
                }
            }
        }
        return coords;
    }

    return null;
}

function updateProgress(current, total, text = '') {
    const percent = (current / total) * 100;
    document.getElementById('progressFill').style.width = percent + '%';
    document.getElementById('progressText').textContent = text || `${current}/${total} (${percent.toFixed(1)}%)`;
    document.getElementById('statusText').textContent = '';
    document.getElementById('statusText').className = 'status-text';
    document.getElementById('progressBar').style.display = 'block';
}

function showStatus(text, isError = false) {
    document.getElementById('progressBar').style.display = 'none';
    document.getElementById('progressText').textContent = '';
    const statusEl = document.getElementById('statusText');
    statusEl.textContent = text;
    statusEl.className = isError ? 'status-text error' : 'status-text';
}

function addSeedResult(seed, coords) {
    if (!seedResults.has(seed)) {
        seedResults.set(seed, []);
    }
    seedResults.get(seed).push(...coords);
    updateResultsDisplay();
}

function updateResultsDisplay() {
    const resultsDiv = document.getElementById('results');
    let html = '';

    for (const [seed, coords] of seedResults) {
        html += `<div class="seed-result">`;
        html += `<div class="seed-title" onclick="copyToClipboard('${seed}')">${seed}</div>`;
        html += `<div class="coord-list">`;

        for (const coord of coords) {
            const tpCommand = `/tp ${coord.x} ${coord.y} ${coord.z}`;
            html += `<div class="coord-item" onclick="copyToClipboard('${tpCommand}')">`;
            html += `(${coord.x}, ${coord.z}) y${coord.y}`;
            html += `</div>`;
        }

        html += `</div></div>`;
    }

    resultsDiv.innerHTML = html;
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).catch(() => {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
    });
}

async function calculate() {
    if (!cb) {
        showStatus('UPLOAD WASM FIRST', true);
        return;
    }

    const mode = document.getElementById('mode').value;
    isRunning = true;
    seedResults.clear();

    document.getElementById('calculateBtn').classList.add('hidden');
    document.getElementById('stopBtn').classList.remove('hidden');
    document.getElementById('results').innerHTML = '';

    try {
        if (mode === 'single') {
            await calculateSingle();
        } else if (mode === 'list') {
            await calculateList();
        } else if (mode === 'bruteforce') {
            await calculateBruteForce();
        }
    } catch (error) {
        showStatus('CALC ERROR', true);
        console.error(error);
    }

    isRunning = false;
    document.getElementById('calculateBtn').classList.remove('hidden');
    document.getElementById('stopBtn').classList.add('hidden');
}

async function calculateSingle() {
    const seed = document.getElementById('seed').value;
    const coords = getCoordinates();

    if (!seed) {
        markError('seed');
        showStatus('INVALID INPUT', true);
        return;
    }

    if (!coords) {
        showStatus('INVALID INPUT', true);
        return;
    }

    const results = [];
    for (let i = 0; i < coords.length && isRunning; i++) {
        const { x, z } = coords[i];
        const height = await getHeight(seed, x, z);
        results.push({ x, z, y: height });

        updateProgress(i + 1, coords.length);
        if (i % 10 === 0) await new Promise(resolve => setTimeout(resolve, 1));
    }

    if (isRunning) {
        addSeedResult(seed, results);
        showStatus(`COMPLETE: ${results.length} COORDS`);
    }
}

async function calculateList() {
    if (seedList.length === 0) {
        showStatus('LOAD SEED LIST FIRST', true);
        return;
    }

    const operator = document.getElementById('operator').value;
    const threshold = parseInt(document.getElementById('threshold').value);
    const coords = getCoordinates();

    if (isNaN(threshold)) {
        markError('threshold');
        showStatus('INVALID INPUT', true);
        return;
    }

    if (!coords) {
        showStatus('INVALID INPUT', true);
        return;
    }

    let totalChecks = seedList.length * coords.length;
    let checked = 0;

    for (let i = 0; i < seedList.length && isRunning; i++) {
        const seed = seedList[i];
        const matches = [];

        for (let j = 0; j < coords.length && isRunning; j++) {
            const { x, z } = coords[j];
            const height = await getHeight(seed, x, z);
            checked++;

            if (checkThreshold(height, operator, threshold)) {
                matches.push({ x, z, y: height });
            }

            updateProgress(checked, totalChecks, `SEED ${i + 1}/${seedList.length}`);

            if (checked % 50 === 0) {
                await new Promise(resolve => setTimeout(resolve, 1));
            }
        }

        if (matches.length > 0) {
            addSeedResult(seed, matches);
        }
    }

    if (isRunning) {
        showStatus(seedResults.size > 0 ? `FOUND ${seedResults.size} MATCHING SEEDS` : 'NO MATCHES');
    }
}

async function calculateBruteForce() {
    const startSeed = parseInt(document.getElementById('startSeed').value);
    const operator = document.getElementById('operator').value;
    const threshold = parseInt(document.getElementById('threshold').value);
    const coords = getCoordinates();

    if (isNaN(startSeed)) {
        markError('startSeed');
        showStatus('INVALID INPUT', true);
        return;
    }

    if (isNaN(threshold)) {
        markError('threshold');
        showStatus('INVALID INPUT', true);
        return;
    }

    if (!coords) {
        showStatus('INVALID INPUT', true);
        return;
    }

    let currentSeed = startSeed;
    let coordsChecked = 0;

    while (isRunning) {
        const matches = [];

        for (let i = 0; i < coords.length && isRunning; i++) {
            const { x, z } = coords[i];
            const height = await getHeight(currentSeed.toString(), x, z);
            coordsChecked++;

            if (checkThreshold(height, operator, threshold)) {
                matches.push({ x, z, y: height });
            }

            updateProgress(i + 1, coords.length, `SEED ${currentSeed}`);

            if (coordsChecked % 100 === 0) {
                await new Promise(resolve => setTimeout(resolve, 1));
            }
        }

        if (matches.length > 0) {
            addSeedResult(currentSeed.toString(), matches);
        }

        currentSeed++;
    }
}

function stopCalc() {
    isRunning = false;
    showStatus('STOPPED');
}

function showError(text) {
    showStatus(text, true);
}

function toggleInfo() {
    const infoContent = document.getElementById('infoContent');
    infoContent.classList.toggle('active');
}