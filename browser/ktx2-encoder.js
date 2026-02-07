import { read, write } from "ktx-parse";

const DefaultOptions = {
    enableDebug: false,
    isUASTC: true,
    isKTX2File: true,
    isInputSRGB: true,
    generateMipmap: true,
    needSupercompression: true,
    isSetKTX2SRGBTransferFunc: true,
    isHDR: false,
    qualityLevel: 150
};

const BasisTextureType = {
    cBASISTexType2D: 0,
    cBASISTexTypeCubemapArray: 2
};

const SourceType = {
    RAW: 0
};

const HDRSourceType = {
    EXR: 3,
    HDR: 4
};

const warnedMethods = new Set();
function applyInputOptions(options = {}, encoder) {
    options = { ...DefaultOptions, ...options };

    const warnMissing = (primary, fallback) => {
        const key = `${primary}|${fallback ?? ""}`;
        if (warnedMethods.has(key))
            return;
        warnedMethods.add(key);
        const fallbackLabel = fallback ? ` or ${fallback}` : "";
        console.warn(`[ktx2-encoder] Encoder method not found: ${primary}${fallbackLabel}`);
    };

    const call = (primary, fallback, value, guard = true) => {
        if (!guard)
            return;
        const method = (typeof encoder[primary] === "function")
            ? encoder[primary]
            : (fallback && typeof encoder[fallback] === "function" ? encoder[fallback] : null);
        if (method) {
            method.call(encoder, value);
        }
        else {
            warnMissing(primary, fallback);
        }
    };

    const call0 = (methodName, guard = true) => {
        if (!guard)
            return;
        if (typeof encoder[methodName] === "function") {
            encoder[methodName]();
        }
    };

    call("setDebug", null, options.enableDebug, options.enableDebug !== undefined);
    call("setUASTC", null, options.isUASTC, options.isUASTC !== undefined);
    call("setCreateKTX2File", null, options.isKTX2File, options.isKTX2File !== undefined);
    call("setKTX2SRGBTransferFunc", "setKTX2AndBasisSRGBTransferFunc", options.isSetKTX2SRGBTransferFunc, options.isSetKTX2SRGBTransferFunc !== undefined);
    call("setMipGen", null, options.generateMipmap, options.generateMipmap !== undefined);
    call("setYFlip", null, options.isYFlip, options.isYFlip !== undefined);
    call0("setNormalMap", options.isNormalMap === true);
    call("setQualityLevel", null, options.qualityLevel, options.qualityLevel !== undefined);
    call("setCompressionLevel", "setETC1SCompressionLevel", options.compressionLevel, options.compressionLevel !== undefined);
    call("setKTX2UASTCSupercompression", null, options.needSupercompression, options.needSupercompression !== undefined);
    call("setRDOUASTC", null, true, options.enableRDO);
    call("setRDOUASTCQualityScalar", null, options.rdoQualityLevel, options.rdoQualityLevel !== undefined);
    call("setPackUASTCFlags", null, options.uastcLDRQualityLevel, options.uastcLDRQualityLevel !== undefined);

    if (options.isHDR) {
        call("setHDR", null, options.isHDR, true);
        call("setUASTCHDRQualityLevel", null, options.hdrQualityLevel, !!options.hdrQualityLevel);
    }

    call("setPerceptual", null, options.isPerceptual, options.isPerceptual !== undefined);
}

const decodeImageBitmap = (function () {
    const getGlContext = (function () {
        let gl = null;
        return function () {
            if (!gl) {
                const canvas = new OffscreenCanvas(128, 128);
                gl = canvas.getContext("webgl2", { premultipliedAlpha: false });
            }
            return gl;
        };
    })();

    return async function webglDecode(imageBuffer) {
        const gl = getGlContext();
        const imageBitmap = await createImageBitmap(new Blob([imageBuffer]));

        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageBitmap);

        const framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

        const width = imageBitmap.width;
        const height = imageBitmap.height;
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.deleteTexture(texture);
        gl.deleteFramebuffer(framebuffer);

        return {
            data: new Uint8Array(pixels),
            width,
            height
        };
    };
})();

let modulePromise = null;
const scriptLoadPromiseMap = new Map();
const DEFAULT_WASM_URL = new URL("./basis_encoder.wasm", import.meta.url).href;
const DEFAULT_JS_URL = new URL("./basis_encoder.js", import.meta.url).href;

function resolveBasisFactory(mod) {
    if (!mod)
        return null;
    const candidates = [
        mod.default,
        mod.BASIS,
        mod.default?.default,
        mod.default?.BASIS
    ];
    for (const candidate of candidates) {
        if (typeof candidate === "function")
            return candidate;
    }
    return null;
}

function loadClassicScript(url) {
    const cached = scriptLoadPromiseMap.get(url);
    if (cached)
        return cached;

    const promise = new Promise((resolve, reject) => {
        if (typeof document === "undefined") {
            reject(new Error("Cannot load BASIS script outside browser document context."));
            return;
        }
        const script = document.createElement("script");
        script.async = true;
        script.src = url;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load BASIS script: ${url}`));
        document.head.appendChild(script);
    }).catch((err) => {
        scriptLoadPromiseMap.delete(url);
        throw err;
    });

    scriptLoadPromiseMap.set(url, promise);
    return promise;
}

async function loadBasisFactory(jsUrl) {
    let importError = null;
    try {
        const imported = await import(/* @vite-ignore */ jsUrl);
        const factory = resolveBasisFactory(imported);
        if (factory)
            return factory;
    }
    catch (err) {
        importError = err;
    }

    await loadClassicScript(jsUrl);
    if (typeof globalThis.BASIS === "function") {
        return globalThis.BASIS;
    }

    if (importError) {
        throw new Error(`Unable to resolve BASIS factory from ${jsUrl}: ${importError instanceof Error ? importError.message : String(importError)}`);
    }

    throw new Error(`Unable to resolve BASIS factory from ${jsUrl}.`);
}

async function initBasisModule(options = {}) {
    if (!modulePromise) {
        const wasmUrl = options?.wasmUrl ?? DEFAULT_WASM_URL;
        const jsUrl = options?.jsUrl ?? DEFAULT_JS_URL;

        modulePromise = Promise.all([
            loadBasisFactory(jsUrl),
            wasmUrl ? fetch(wasmUrl).then((res) => res.arrayBuffer()) : undefined
        ])
            .then(([BASIS, wasmBinary]) => BASIS({ wasmBinary }))
            .then((Module) => {
            Module.initializeBasis();
            return Module;
        });
    }
    return modulePromise;
}

async function encodeInternal(bufferOrBufferArray, options = {}) {
    const basisModule = await initBasisModule(options);
    const encoder = new basisModule.BasisEncoder();
    applyInputOptions(options, encoder);

    const isCube = Array.isArray(bufferOrBufferArray) && bufferOrBufferArray.length === 6;
    encoder.setTexType(isCube ? BasisTextureType.cBASISTexTypeCubemapArray : BasisTextureType.cBASISTexType2D);

    const bufferArray = Array.isArray(bufferOrBufferArray) ? bufferOrBufferArray : [bufferOrBufferArray];
    for (let i = 0; i < bufferArray.length; i++) {
        const buffer = bufferArray[i];
        if (options.isHDR) {
            encoder.setSliceSourceImageHDR(i, buffer, 0, 0, options.imageType === "hdr" ? HDRSourceType.HDR : HDRSourceType.EXR, true);
        }
        else {
            const imageData = await options.imageDecoder(buffer);
            encoder.setSliceSourceImage(i, new Uint8Array(imageData.data), imageData.width, imageData.height, SourceType.RAW);
        }
    }

    const ktx2FileData = new Uint8Array(1024 * 1024 * (options.isHDR ? 24 : 10));
    const byteLength = encoder.encode(ktx2FileData);
    if (byteLength === 0) {
        throw new Error("Encode failed");
    }

    let output = new Uint8Array(ktx2FileData.buffer, 0, byteLength);
    if (options.kvData) {
        const container = read(ktx2FileData);
        for (const k in options.kvData) {
            container.keyValue[k] = options.kvData[k];
        }
        output = write(container, { keepWriter: true });
    }

    return output;
}

export function encodeToKTX2(imageBuffer, options = {}) {
    options.imageDecoder ??= decodeImageBitmap;
    globalThis.__KTX2_DEBUG__ = options.enableDebug ?? false;
    return encodeInternal(imageBuffer, options);
}
