let wasmModule = null;
let cb = null;
let provider = null;
let currentSeed = null;
let seedList = [];
let isRunning = false;

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('wasmFile').addEventListener('change', handleWasmFile);
    document.getElementById('mode').addEventListener('change', updateInputs);
    document.getElementById('coordMode').addEventListener('change', updateCoordInputs);
    document.getElementById('seedListFile').addEventListener('change', handleSeedListFile);
    document.getElementById('calculateBtn').addEventListener('click', calculate);
    document.getElementById('stopBtn').addEventListener('click', stopCalc);
    document.querySelector('.info-btn').addEventListener('click', toggleInfo);

    document.addEventListener('click', (e) => {
        const info = document.getElementById('infoContent');
        const infoBtn = document.querySelector('.info-btn');
        if (!infoBtn.contains(e.target) && !info.contains(e.target)) {
            info.classList.remove('active');
        }
    });
});

async function handleWasmFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    const status = document.getElementById('wasmStatus');
    status.textContent = 'LOADING...';

    try {
        const wasmBytes = await file.arrayBuffer();
        wasmModule = await WebAssembly.compile(wasmBytes);
        cb = createCb(wasmModule);
        status.textContent = 'READY';
        document.getElementById('mainInputs').classList.remove('hidden');
        updateInputs();
    } catch (error) {
        status.textContent = 'ERROR: ' + error.message;
        console.error(error);
    }
}

async function handleSeedListFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    const status = document.getElementById('seedListStatus');
    status.textContent = 'LOADING...';

    try {
        const text = await file.text();
        seedList = text.split('\n').map(line => line.trim()).filter(line => line);
        status.textContent = `LOADED ${seedList.length} SEEDS`;
        updateInputs();
    } catch (error) {
        status.textContent = 'ERROR: ' + error.message;
        console.error(error);
    }
}

function updateInputs() {
    const mode = document.getElementById('mode').value;

    // Show/hide mode-specific inputs
    document.getElementById('seedListInputs').classList.toggle('hidden', mode !== 'list');
    document.getElementById('bruteForceInputs').classList.toggle('hidden', mode !== 'bruteforce');
    document.getElementById('commonInputs').classList.toggle('hidden', mode !== 'single');
    
    // Show coordinate inputs for all modes
    document.getElementById('coordinateInputs').classList.remove('hidden');
    
    // Show threshold inputs for list and bruteforce modes
    document.getElementById('thresholdInputs').classList.toggle('hidden', mode === 'single');
    
    updateCoordInputs();
}

function updateCoordInputs() {
    const mode = document.getElementById('mode').value;
    const coordMode = document.getElementById('coordMode').value;
    
    // For single mode, restrict to single coordinate only
    if (mode === 'single') {
        document.getElementById('coordMode').value = 'single';
        document.getElementById('coordMode').disabled = true;
        document.getElementById('singleCoordInputs').classList.remove('hidden');
        document.getElementById('rangeCoordInputs').classList.add('hidden');
        document.getElementById('centerCoordInputs').classList.add('hidden');
    } else {
        // Enable coordinate mode selection for list and bruteforce modes
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
        static fromString = str => {
            const val = BigInt(str);
            return new Long(Number(val & 0xFFFFFFFFn), Number(val >> 32n));
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

    const wasm = new WebAssembly.Instance(wasmModule, imports).exports;
    const getMemory = () => new Int32Array(wasm.memory.buffer);

    class World {
        constructor(low, high, edition, version, biomeSize, largeBiomes) {
            this.ptr = wasm.world_new(low, high, edition, version, biomeSize != null, biomeSize || 0, largeBiomes);
        }
        free = () => {
            if (this.ptr) {
                wasm.__wbg_world_free(this.ptr);
                this.ptr = 0;
            }
        };
    }

    class MultiNoiseBiomeSource {
        constructor(world) {
            this.ptr = wasm.multinoisebiomesource_new(world.ptr);
        }
        getSurfaceArea(x, z, w, h, scale, heightType, surfaceType) {
            const stackPtr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ht = {
                oceanFloor: 2,
                worldSurface: 1,
                caveDepth: 3,
                bottom: 4,
                depth0: 5
            };
            const st = {
                fastApproximate: 1,
                enhancedNoCaves: 2,
                enhanced: 3,
                topmostAccurate: 4
            };
            wasm.multinoisebiomesource_get_surface_area(
                stackPtr, this.ptr, x, z, w, h, scale, ht[heightType] || 2, st[surfaceType] || 2
            );
            const mem = getMemory();
            const dataPtr = mem[stackPtr / 4], len = mem[stackPtr / 4 + 1];
            const res = new Int32Array(wasm.memory.buffer, dataPtr, len).slice();
            wasm.__wbindgen_free(dataPtr, len * 4, 4);
            wasm.__wbindgen_add_to_stack_pointer(16);
            return res;
        }
        free = () => {
            if (this.ptr) {
                wasm.__wbg_multinoisebiomesource_free(this.ptr);
                this.ptr = 0;
            }
        };
    }

    return {
        Long,
        createBiomeProvider: ({ seed, version, config }) => {
            const world = new World(seed.low, seed.high, 2, version, config.biomeSize, config.largeBiomes);
            const provider = new MultiNoiseBiomeSource(world);
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
            version: 10210,
            config: {},
            seed: cb.Long.fromString(seed)
        });
        currentSeed = seed;
    }

    const coordX = x >> 2;
    const coordZ = z >> 2;
    const buf = new Int32Array(provider.getSurfaceArea(
        coordX, coordZ, 1, 1, 1, "oceanFloor", "enhancedNoCaves"
    ).buffer);

    return buf[0];
}

function checkThreshold(height, operator, threshold) {
    switch (operator) {
        case '>': return height > threshold;
        case '<': return height < threshold;
        case '=': return height === threshold;
        default: return false;
    }
}

function getCoordinates() {
    const coordMode = document.getElementById('coordMode').value;
    
    if (coordMode === 'single') {
        const x = parseInt(document.getElementById('x').value);
        const z = parseInt(document.getElementById('z').value);
        if (isNaN(x) || isNaN(z)) return null;
        return [{ x, z }];
    } 
    else if (coordMode === 'range') {
        const xMin = parseInt(document.getElementById('xMin').value);
        const xMax = parseInt(document.getElementById('xMax').value);
        const zMin = parseInt(document.getElementById('zMin').value);
        const zMax = parseInt(document.getElementById('zMax').value);
        const stepSize = parseInt(document.getElementById('stepSize').value) || 16;
        
        if (isNaN(xMin) || isNaN(xMax) || isNaN(zMin) || isNaN(zMax)) return null;
        
        const coordinates = [];
        for (let x = xMin; x <= xMax; x += stepSize) {
            for (let z = zMin; z <= zMax; z += stepSize) {
                coordinates.push({ x, z });
            }
        }
        return coordinates;
    } 
    else if (coordMode === 'center') {
        const centerX = parseInt(document.getElementById('centerX').value);
        const centerZ = parseInt(document.getElementById('centerZ').value);
        const radius = parseInt(document.getElementById('radius').value) || 100;
        const stepSize = parseInt(document.getElementById('centerStepSize').value) || 16;
        
        if (isNaN(centerX) || isNaN(centerZ)) return null;
        
        const coordinates = [];
        for (let x = centerX - radius; x <= centerX + radius; x += stepSize) {
            for (let z = centerZ - radius; z <= centerZ + radius; z += stepSize) {
                const distance = Math.sqrt((x - centerX) ** 2 + (z - centerZ) ** 2);
                if (distance <= radius) {
                    coordinates.push({ x, z });
                }
            }
        }
        return coordinates;
    }
    
    return null;
}

async function calculate() {
    if (!cb) {
        showError('UPLOAD WASM FIRST');
        return;
    }

    const mode = document.getElementById('mode').value;
    isRunning = true;
    document.getElementById('calculateBtn').classList.add('hidden');
    document.getElementById('stopBtn').classList.remove('hidden');

    try {
        if (mode === 'single') {
            await calculateSingle();
        } else if (mode === 'list') {
            await calculateList();
        } else if (mode === 'bruteforce') {
            await calculateBruteForce();
        }
    } catch (error) {
        showError('CALC ERROR');
        console.error(error);
    }

    isRunning = false;
    document.getElementById('calculateBtn').classList.remove('hidden');
    document.getElementById('stopBtn').classList.add('hidden');
}

async function calculateSingle() {
    const seed = document.getElementById('seed').value;
    const coordinates = getCoordinates();

    if (!seed || !coordinates) {
        showError('INVALID INPUT');
        return;
    }

    if (coordinates.length === 1) {
        // Single coordinate
        const { x, z } = coordinates[0];
        const height = await getHeight(seed, x, z);
        showResult(`(${x}, ${z}) y${height}`);
    } else {
        // Multiple coordinates
        let results = [];
        for (let i = 0; i < coordinates.length && isRunning; i++) {
            const { x, z } = coordinates[i];
            const height = await getHeight(seed, x, z);
            results.push(`(${x}, ${z}) y${height}`);

            if (i % 50 === 0 || i === coordinates.length - 1) {
                showResult(`PROGRESS ${i + 1}/${coordinates.length}\n\n${results.join('\n')}`);
                await new Promise(resolve => setTimeout(resolve, 1));
            }
        }
        
        if (isRunning) {
            showResult(results.join('\n'));
        }
    }
}

async function calculateList() {
    if (seedList.length === 0) {
        showError('LOAD SEED LIST FIRST');
        return;
    }

    const operator = document.getElementById('operator').value;
    const threshold = parseInt(document.getElementById('threshold').value);
    const coordinates = getCoordinates();

    if (isNaN(threshold) || !coordinates) {
        showError('INVALID INPUT');
        return;
    }

    let results = [];
    let coordChecks = 0;

    for (let i = 0; i < seedList.length && isRunning; i++) {
        const seed = seedList[i];
        
        for (let j = 0; j < coordinates.length && isRunning; j++) {
            const { x, z } = coordinates[j];
            const height = await getHeight(seed, x, z);
            coordChecks++;

            if (checkThreshold(height, operator, threshold)) {
                results.push(`${seed} (${x}, ${z}) y${height}`);
            }

            // Update progress every 50 coordinate checks or when starting new seed
            if (coordChecks % 50 === 0 || j === 0) {
                showResult(`CHECKING ${i + 1}/${seedList.length}\n${results.join('\n')}`);
                await new Promise(resolve => setTimeout(resolve, 1));
            }
        }
    }

    showResult(results.length > 0 ? results.join('\n') : 'NO MATCHES');
}

async function calculateBruteForce() {
    const startSeed = parseInt(document.getElementById('startSeed').value);
    const operator = document.getElementById('operator').value;
    const threshold = parseInt(document.getElementById('threshold').value);
    const coordinates = getCoordinates();

    if (isNaN(startSeed) || isNaN(threshold) || !coordinates) {
        showError('INVALID INPUT');
        return;
    }

    let results = [];
    let currentSeedNum = startSeed;
    let coordChecks = 0;

    while (isRunning) {
        for (let j = 0; j < coordinates.length && isRunning; j++) {
            const { x, z } = coordinates[j];
            const height = await getHeight(currentSeedNum.toString(), x, z);
            coordChecks++;

            if (checkThreshold(height, operator, threshold)) {
                results.push(`${currentSeedNum} (${x}, ${z}) y${height}`);
                showResult(results.join('\n'));
            }

            // Update progress display every 100 coordinate checks or when switching to new seed
            if (coordChecks % 100 === 0 || j === 0) {
                showResult(`CHECKING SEED ${currentSeedNum}\n${results.join('\n')}`);
                await new Promise(resolve => setTimeout(resolve, 1));
            }
        }
        currentSeedNum++;
    }
}

function stopCalc() {
    isRunning = false;
}

function showResult(text) {
    document.getElementById('output').innerHTML = `<div class="result"><pre>${text}</pre></div>`;
}

function showError(text) {
    document.getElementById('output').innerHTML = `<div class="error">${text}</div>`;
}

function toggleInfo() {
    const info = document.getElementById('infoContent');
    info.classList.toggle('active');
}