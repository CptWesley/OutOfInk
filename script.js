const convertButton = document.getElementById('convert-button');
const inputPdf = document.getElementById('input-pdf');
const sourceCanvas = document.getElementById('source-canvas');
const targetCanvas = document.getElementById('target-canvas');
const swapsContainer = document.getElementById('swaps-container');
const pageSlider = document.getElementById('page-slider');
const pageText = document.getElementById('page-text');
const qualitySlider = document.getElementById('quality-slider');
const qualityText = document.getElementById('quality-text');
const progressText = document.getElementById('progress-text');
const resetButton = document.getElementById('reset-button');
const PDFJS = window['pdfjs-dist/build/pdf'];

const defaultQuality = 4;

let pdf = undefined;
let pdfFileName = undefined;

let bg = undefined;

inputPdf.addEventListener('change', e => {
    const file = e.target.files[0];
    readFileAsBytes(file, (bytes) => {
        PDFJS.getDocument({data: bytes}).promise.then(loadedPdf => {
            pdf = loadedPdf;
            loadPreview();
            pageSlider.max = pdf.numPages;
            pageSlider.value = 1;
            convertButton.disabled = false;
            pageSlider.disabled = false;
        });
    });
});

resetButton.addEventListener('click', resetSettings);

pageSlider.addEventListener('input', loadPreview);
convertButton.addEventListener('click', exportPdf);

qualitySlider.addEventListener('input', () => {
    qualityText.innerText = 'Export Quality ' + qualitySlider.value + '/' + qualitySlider.max;
    saveSettings();
});

const cyanSelector = createSelector('cyan');
const magentaSelector = createSelector('magenta');
const yellowSelector = createSelector('yellow');

loadSettings();

function createSelector(input) {
    const id = 'selector-' + input;
    const label = document.createElement('label');
    label.for = id;
    label.innerText = input;
    const el = document.createElement('select');
    el.id = id;
    el.name = input;
    const div = document.createElement('div');
    div.appendChild(label);
    div.appendChild(el);
    swapsContainer.appendChild(div);

    el.appendChild(createOption('none', 'None'));
    el.appendChild(createOption('cyan', 'Cyan'));
    el.appendChild(createOption('magenta', 'Magenta'));
    el.appendChild(createOption('yellow', 'Yellow'));
    el.appendChild(createOption('cyan+magenta', 'Cyan + Magenta'));
    el.appendChild(createOption('cyan+yellow', 'Cyan + Yellow'));
    el.appendChild(createOption('magenta+yellow', 'Magenta + Yellow'));
    el.appendChild(createOption('black', 'Black (Cyan + Magenta + Yellow)'));
    el.value = input;

    el.addEventListener('change', () => {
        saveSettings();
        loadPreview();
    });

    return el;
}

function createOption(value, name) {
    const el = document.createElement('option');
    el.value = value;
    el.innerText = name;

    return el;
}

function loadPreview() {
    if (!pdf) {
        return;
    }

    const pageNumber = parseInt(pageSlider.value);
    pageText.innerText = 'Page ' + pageNumber + '/' + pdf.numPages;

    loadPage(pageNumber, 1, (ctx) => {
        renderCanvas(ctx, sourceCanvas);
        renderCanvas(ctx, targetCanvas, correctImageData);
    });
}

function correctImageData(data) {
    bg = undefined;
    for (let x = 0; x < data.width; x++) {
        for (let y = 0; y < data.height; y++) {
            const cmyk = getPixelCmyk(data, x, y);
            const corrected = correctCmykColor(cmyk);
            setPixelCmyk(data, x, y, corrected);
        }
    }
}

function correctCmykColor(color) {
    if (!bg) {
        bg = color;
    }

    if (color.cyan === bg.cyan && color.magenta === bg.magenta && color.yellow === bg.yellow && color.black === bg.black) {
        return cmyk(0, 0, 0, 0);
    }

    const result = {
        cyan: 0,
        magenta: 0,
        yellow: 0,
        black: 0,
        none: 0,
    };

    for (const channel of cyanSelector.value.split('+')) {
        result[channel] += color.cyan + color.black;
    }

    for (const channel of magentaSelector.value.split('+')) {
        result[channel] += color.magenta + color.black;
    }

    for (const channel of yellowSelector.value.split('+')) {
        result[channel] += color.yellow + color.black;
    }

    result.cyan = Math.max(0, Math.min(1, result.cyan));
    result.magenta = Math.max(0, Math.min(1, result.magenta));
    result.yellow = Math.max(0, Math.min(1, result.yellow));

    return result;
}

function renderCanvas(sourceCtx, targetCanvas, transformation) {
    const targetCtx = targetCanvas.getContext('2d');
    targetCanvas.height = sourceCtx.canvas.height;
    targetCanvas.width = sourceCtx.canvas.width;

    const data = sourceCtx.getImageData(0, 0, targetCanvas.width, targetCanvas.height);
    
    if (transformation) {
        transformation(data);
    }

    targetCtx.putImageData(data, 0, 0);
}

function loadPage(pageNumber, scale, cb) {
    pdf.getPage(pageNumber).then(page => {
        const viewport = page.getViewport({scale: scale});
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };

        const renderTask = page.render(renderContext);
        renderTask.promise.then(() => cb(context));
    });
}

function unloadFile() {
    convertButton.disabled = true;
    pageSlider.disabled = true;
    pdf = undefined;
    pageSlider.value = 1;
}

function readFileAsBytes(file, cb) {
    if (!file) {
        unloadFile();
        return;
    }

    const reader = new FileReader();
    const fileByteArray = [];
    pdfFileName = file.name;
    reader.readAsArrayBuffer(file);
    reader.addEventListener('loadend', e => {
        if (e.target.readyState === FileReader.DONE) {
            const arrayBuffer = e.target.result;
            const array = new Uint8Array(arrayBuffer);
            for (const a of array) {
                fileByteArray.push(a);
            }

            cb(fileByteArray);
        }
    });
}

function exportPdf() {
    if (!pdf) {
        return;
    }

    PDFLib.PDFDocument.create().then(newPdf => {
        writeNextPdfPage(newPdf, 1, pdf.numPages, () => newPdf.save().then(savePdf));
    });
}

function setProgress(msg) {
    console.log(msg);
    progressText.innerText = msg;
}

function writeNextPdfPage(pdf, pageNumber, maxPageNumber, cb) {
    if (pageNumber > maxPageNumber) {
        convertButton.disabled = false;
        setProgress('Saving PDF...');
        cb();
        return;
    }

    convertButton.disabled = true;
    setProgress('Converting page ' + pageNumber + ' of ' + maxPageNumber + '...');

    const scale = parseInt(qualitySlider.value);

    loadPage(pageNumber, scale, (ctx) => {
        const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
        correctImageData(imageData);
        ctx.putImageData(imageData, 0, 0);
        ctx.canvas.toBlob(blob => {
            const reader = new FileReader();
            reader.addEventListener('loadend', e => {
                const imgBuffer = e.target.result;
                pdf.embedPng(imgBuffer).then(img => {
                    const width = ctx.canvas.width / scale;
                    const height = ctx.canvas.height / scale;
                    const page = pdf.addPage([width, height]);
                    page.drawImage(img, { x: 0, y: 0, width: width, height: height });
                    writeNextPdfPage(pdf, pageNumber + 1, maxPageNumber, cb);
                });
            });
            reader.readAsArrayBuffer(blob);
        });
    });
}

function rgb(red, green, blue) {
    return {
        red: red,
        green: green,
        blue: blue,
    };
}

function cmyk(cyan, magenta, yellow, black) {
    return {
        cyan: cyan,
        magenta: magenta,
        yellow: yellow,
        black: black,
    };
}

function rgb2cmyk(rgb) {
    const r = rgb.red / 255;
    const g = rgb.green / 255;
    const b = rgb.blue / 255;

    const k = 1 - Math.max(r, g, b);
    const c = k !== 0 ? (1 - r - k) / (1 - k) : 0;
    const m = k !== 0 ? (1 - g - k) / (1 - k) : 0;
    const y = k !== 0 ? (1 - b - k) / (1 - k) : 0;

    return cmyk(c, m, y, k);
}

function cmyk2rgb(cmyk) {
    const r = (1 - cmyk.cyan) * (1 - cmyk.black) * 255;
    const g = (1 - cmyk.magenta) * (1 - cmyk.black) * 255;
    const b = (1 - cmyk.yellow) * (1 - cmyk.black) * 255;
    return rgb(r, g, b);
}

function getPixelRgb(data, x, y) {
    const width = data.width;
    data = data.data;
  
    const i = y * (width * 4) + x * 4;
    return rgb(data[i], data[i + 1], data[i + 2]);
}

function setPixelRgb(data, x, y, color) {
    const width = data.width;
    data = data.data;
  
    const i = y * (width * 4) + x * 4;
    data[i] = color.red;
    data[i + 1] = color.green;
    data[i + 2] = color.blue;
}

function getPixelCmyk(data, x, y) {
    const rgb = getPixelRgb(data, x, y);
    return rgb2cmyk(rgb);
}

function setPixelCmyk(data, x, y, color) {
    const rgb = cmyk2rgb(color);
    setPixelRgb(data, x, y, rgb);
}

function savePdf(bytes) {
    const fileName = 'out-of-ink-' + (pdfFileName ?? 'output.pdf');
    const a = document.createElement('a');
    const file = new Blob([bytes], {type: 'application/pdf'});
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
    setProgress('Done.');
}

function load(key, defaultValue) {
    const json = localStorage.getItem(key);
    if (!json) {
        return defaultValue;
    }

    return JSON.parse(json);
}

function store(key, value) {
    const json = JSON.stringify(value);
    localStorage.setItem(key, json);
}

function loadSettings() {
    cyanSelector.value = load('cyan-channel', 'cyan');
    magentaSelector.value = load('magenta-channel', 'magenta');
    yellowSelector.value = load('yellow-channel', 'yellow');
    qualitySlider.value = load('quality', defaultQuality);
    qualityText.innerText = 'Export Quality ' + qualitySlider.value + '/' + qualitySlider.max;
}

function saveSettings() {
    store('cyan-channel', cyanSelector.value);
    store('magenta-channel', magentaSelector.value);
    store('yellow-channel', yellowSelector.value);
    store('quality', parseInt(qualitySlider.value));
}

function resetSettings() {
    localStorage.clear();
    loadSettings();
    loadPreview();
}